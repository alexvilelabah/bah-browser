---
name: date-picker
description: Set check-in/check-out or other dates in calendar widgets.
states: [datepicker]
priority: 40
---
A calendar/date picker is on the page.
1. Open it by clicking the date field ("Check-in", "Dates", "Departure") if the calendar is not visible.
2. Use the year from the TODAY line (a date without a year is its next occurrence). Day cells usually carry a full date in their label (e.g. "12 December 2026" or "2026-12-12"). Use find "12 December 2026" (or the site's format) to locate the exact cell, then click_ref it. Do not click a bare "12": every month shows a 12.
3. Wrong month showing? Click the next/previous month arrow ("Next month", "›") until the month is visible. Do not type into the grid.
4. Ranges (hotels, flights): click the START date, then the END date — TWO clicks in the same calendar. One click leaves a 1-night/one-way default.
7. Before reading results, VERIFY: the date field (or the results URL's checkin/checkout) must show exactly the intended dates. If not, fix them first. In the answer, state the dates the page actually shows.
5. If there is a plain date input (type=date), fill_ref it with the date in YYYY-MM-DD.
6. Use look_at on the calendar if the day numbers are too small to read.
