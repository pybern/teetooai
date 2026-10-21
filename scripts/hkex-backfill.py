#!/usr/bin/env python3
"""Fetch full-day HKEX short-selling tables and reconcile their published totals."""

import argparse
import csv
import gzip
import html
import json
import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


FIELDS = [
    "board", "trading_date", "stock_code", "stock_name",
    "short_selling_shares", "short_selling_value",
    "total_traded_shares", "total_turnover", "trading_currency", "source_url",
]
ROW = re.compile(
    r"^[ \t]*([%*]*)[ \t]*(\d{1,5})[ \t]+(.+?)[ \t]+"
    r"([\d,]+)[ \t]+([\d,]+)[ \t]+([\d,]+)[ \t]+([\d,]+)[ \t]*$",
    re.M,
)
QUOTE = re.compile(
    r"^[ \t]*[*%]*[ \t]*(\d{1,5})[ \t#]+(.+?)[ \t]+"
    r"(HKD|CNY|USD)[ \t]+(?:[\d.]+|-|N/A|TRADING SUSPENDED)(?=[ \t\r\n])",
    re.M,
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    return int(value.replace(",", ""))


def parse_report(document, board, trading_date, url):
    document = document.replace("\r\n", "\n").replace("\r", "\n")
    text = html.unescape(re.sub(r"<[^>]+>", "", document))
    match = re.search(r"DATE:\s*(\d{1,2}\s+[A-Z]{3}\s+\d{4})", text)
    require(match is not None, "Missing report trading date")
    actual_date = datetime.strptime(match[1], "%d %b %Y").date()
    require(actual_date == trading_date, f"Date mismatch: {actual_date}")
    heading = "SHORT SELLING TURNOVER - DAILY REPORT"
    require(text.count(heading) >= 2, "Missing full-day short-selling section")
    section = text.rsplit(heading, 1)[1].split(
        "PREVIOUS DAY'S ADJUSTED SHORT SELLING TURNOVER", 1
    )[0]
    quote_sections = re.split(
        r"^[ \t]*QUOTATIONS[ \t]*\r?$", text, flags=re.M
    )
    require(len(quote_sections) >= 3, "Missing quotations section")
    quotations = quote_sections[-1].split("SALES RECORDS FOR ALL STOCKS", 1)[0]
    currencies = {}
    for match in QUOTE.finditer(quotations):
        code, currency = match[1], match[3]
        require(
            code not in currencies or currencies[code] == currency,
            f"Conflicting currencies for {code}",
        )
        currencies[code] = currency
    rows = []
    for match in ROW.finditer(section):
        code = match[2]
        require(code in currencies, f"Missing trading currency for {code}")
        values = [number(match[i]) for i in range(4, 8)]
        require(
            values[0] <= values[2] and values[1] <= values[3],
            f"Short-selling exceeds total for {code}",
        )
        rows.append(dict(zip(FIELDS, [
            board, trading_date.isoformat(), code.zfill(5), match[3].strip(),
            *values, currencies[code], url,
        ])))
    count = re.search(
        r"Total No\. of all Securities recording Short Selling\s*:\s*(\d+)",
        section,
    )
    require(count is not None, "Missing published security count")
    require(len(rows) == int(count[1]), "Security count does not reconcile")
    require(
        len({row["stock_code"] for row in rows}) == len(rows),
        "Duplicate stock codes",
    )
    totals = re.search(
        r"Total Shares \(SH\):\s*([\d,]+)\s+([\d,]+)", section
    )
    require(totals is not None, "Missing share totals")
    for key, published in zip(
        ["short_selling_shares", "total_traded_shares"], totals.groups()
    ):
        require(
            sum(row[key] for row in rows) == number(published),
            f"{key} does not reconcile",
        )
    money_totals = list(re.finditer(
        r"^[ \t]*(HKD|CNY|USD) Stocks -[ \t]+(HKD|CNY|USD)[ \t]+"
        r"([\d,]+)[ \t]+(HKD|CNY|USD)[ \t]+([\d,]+)", section, re.M,
    ))
    require(
        {m[1] for m in money_totals if number(m[3]) or number(m[5])}
        == {r["trading_currency"] for r in rows
            if r["short_selling_value"] or r["total_turnover"]},
        "Currency coverage does not reconcile",
    )
    for match in money_totals:
        require(match[1] == match[2] == match[4], "Currency label mismatch")
        currency_rows = [r for r in rows if r["trading_currency"] == match[1]]
        for key, published in [
            ("short_selling_value", match[3]), ("total_turnover", match[5])
        ]:
            require(
                sum(r[key] for r in currency_rows) == number(published),
                f"{match[1]} {key} does not reconcile",
            )
    return rows


def report_url(board, day):
    root = "https://www.hkex.com.hk/eng/stat/smstat/dayquot/"
    stamp = day.strftime("%y%m%d")
    return root + (f"d{stamp}e.htm" if board == "Main Board"
                   else f"GEM/e_G{stamp}.htm")


def fetch_report(board, day):
    url = report_url(board, day)
    result = dict(board=board, date=day.isoformat(), url=url)
    for attempt in range(3):
        time.sleep(0.2)
        request = Request(url, headers={
            "User-Agent": "teetooai-hkex-source-validation/1.0",
            "Accept-Encoding": "gzip",
        })
        try:
            with urlopen(request, timeout=45) as response:
                payload = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    payload = gzip.decompress(payload)
                charset = response.headers.get_content_charset() or "iso-8859-1"
                document = payload.decode(charset)
            if "Hong Kong Public Holiday, NO TRADING." in document:
                return {
                    **result, "status": "market_closed",
                    "reason": "HKEX report explicitly states public holiday, no trading",
                }, []
            rows = parse_report(document, board, day, url)
            return {**result, "status": "validated", "rows": len(rows)}, rows
        except HTTPError as error:
            result.update(http_status=error.code, error=str(error))
            error.close()
            if error.code == 404:
                return {**result, "status": "not_found"}, []
            if error.code not in (429, 500, 502, 503, 504):
                return {**result, "status": "http_error"}, []
            result["status"] = "http_error"
        except (URLError, TimeoutError, ConnectionError) as error:
            result.update(status="network_error", error=str(error))
        except (ValueError, UnicodeError, OSError) as error:
            return {**result, "status": "validation_error", "error": str(error)}, []
        if attempt < 2:
            time.sleep(2 ** (attempt + 1))
    return result, []


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=date.fromisoformat, required=True)
    parser.add_argument("--end", type=date.fromisoformat, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume", action="store_true",
                        help="Reuse validated reports and 404s; retry failed requests")
    args = parser.parse_args()
    require(args.start <= args.end, "Start must not be after end")
    require(args.end < datetime.now(timezone.utc).date(),
            "Only past dates may be requested; today's report may be incomplete")
    args.output.mkdir(parents=True, exist_ok=True)
    csv_path = args.output / "hkex-short-selling.csv"
    log_path = args.output / "hkex-fetch-log.jsonl"
    summary_path = args.output / "hkex-coverage.json"
    if not args.resume:
        require(not any(p.exists() for p in [csv_path, log_path, summary_path]),
                "Output already exists; choose a new directory or use --resume")
    days = []
    day = args.start
    while day <= args.end:
        if day.weekday() < 5:
            days.append(day)
        day += timedelta(days=1)
    jobs = [(board, day) for day in days for board in ["Main Board", "GEM"]]
    results, all_rows = [], []
    if args.resume:
        require(csv_path.exists() and log_path.exists(),
                "Resume requires both the CSV and fetch log")
        previous = {}
        for line in log_path.read_text().splitlines():
            result = json.loads(line)
            key = (result["board"], date.fromisoformat(result["date"]))
            require(key in jobs, "Existing log is outside the requested range")
            previous[key] = result
        results = [r for r in previous.values()
                   if r["status"] in ("validated", "not_found", "market_closed")]
        with csv_path.open(newline="") as source:
            all_rows = list(csv.DictReader(source))
        for row in all_rows:
            for key in FIELDS[4:8]:
                row[key] = int(row[key])
            key = (row["board"], date.fromisoformat(row["trading_date"]))
            require(key in previous and previous[key]["status"] == "validated",
                    "CSV contains a report not validated in the fetch log")
        for result in results:
            if result["status"] == "validated":
                saved_count = sum(r["board"] == result["board"]
                                  and r["trading_date"] == result["date"]
                                  for r in all_rows)
                require(saved_count == result["rows"], "Incomplete saved report")
        cached = {(r["board"], date.fromisoformat(r["date"])) for r in results}
        jobs = [job for job in jobs if job not in cached]
    total_jobs = len(results) + len(jobs)
    mode = "a" if args.resume else "w"
    with csv_path.open(mode, newline="") as csv_file, log_path.open(mode) as log:
        writer = csv.DictWriter(csv_file, fieldnames=FIELDS)
        if not args.resume:
            writer.writeheader()
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(fetch_report, board, day)
                       for board, day in jobs]
            for future in as_completed(futures):
                result, rows = future.result()
                results.append(result)
                all_rows.extend(rows)
                writer.writerows(rows)
                csv_file.flush()
                log.write(json.dumps(result) + "\n")
                log.flush()
                if result["status"] != "not_found" or len(results) % 25 == 0:
                    print(
                        f"{len(results)}/{total_jobs} {result['date']} "
                        f"{result['board']}: {result['status']} "
                        f"{result.get('rows', 0)} rows "
                        f"{result.get('error', '')}", flush=True,
                    )
    all_rows.sort(key=lambda row: (row["trading_date"], row["stock_code"]))
    keys = {(row["trading_date"], row["stock_code"]) for row in all_rows}
    require(len(keys) == len(all_rows), "Duplicate date/stock-code keys")
    with csv_path.open("w", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(all_rows)
    good = [r for r in results if r["status"] == "validated"]
    dates = sorted({r["date"] for r in good})
    complete_dates = [d for d in dates
                      if {r["board"] for r in good if r["date"] == d}
                      == {"Main Board", "GEM"}]
    summary = dict(
        fetched_at_utc=datetime.now(timezone.utc).isoformat(),
        requested_start=args.start.isoformat(), requested_end=args.end.isoformat(),
        report_requests=total_jobs, statuses=dict(Counter(r["status"] for r in results)),
        rows=len(all_rows), rows_by_board=dict(Counter(r["board"] for r in all_rows)),
        rows_by_currency=dict(Counter(r["trading_currency"] for r in all_rows)),
        accessible_start=dates[0] if dates else None,
        accessible_end=dates[-1] if dates else None,
        dates_with_both_boards=complete_dates,
        partial_dates=[d for d in dates if d not in complete_dates],
        unavailable_or_failed=sorted(
            [r for r in results if r["status"] != "validated"],
            key=lambda r: (r["date"], r["board"]),
        ),
        notes=[
            "Weekends were skipped. A 404 is not classified as a trading holiday: "
            "the file may instead be outside public retention or unavailable.",
            "No missing observations were filled with zero.",
            "Includes ETPs and other securities; no ordinary-share-only filter.",
            "Records use stock code and trading date, not an internal Stock Id.",
            "Original full-day tables only; subsequent corrections are not applied.",
            "Technical access does not establish redistribution or commercial rights.",
        ],
    )
    summary_path.write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({k: v for k, v in summary.items()
                      if k not in ["unavailable_or_failed", "dates_with_both_boards"]},
                     indent=2))
    print(f"Saved {csv_path}\nSaved {summary_path}\nSaved {log_path}")
    return 2 if any(r["status"] not in ("validated", "not_found", "market_closed")
                    for r in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
