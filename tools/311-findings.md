# Chicago 311 (v6vf-nfxy) — Step 0 discovery findings

Run: live queries only, 2026-08-28T22:55:55.531Z → wall clock 101.8s.
Every number below came from an HTTP response in this run. Nothing is remembered or estimated.

## 1. Field inventory
Fields returned (42): :@computed_region_43wa_7qmu, :@computed_region_6mkv_f3dw, :@computed_region_bdys_3d7i, :@computed_region_du4m_ji7t, :@computed_region_rpca_8um6, :@computed_region_vrxf_vc4k, city, closed_date, community_area, created_date, created_day_of_week, created_department, created_hour, created_month, duplicate, electrical_district, electricity_grid, last_modified_date, latitude, legacy_record, location, longitude, origin, owner_department, police_beat, police_district, police_sector, precinct, sr_number, sr_short_code, sr_type, state, status, street_address, street_direction, street_name, street_number, street_type, ward, x_coordinate, y_coordinate, zip_code

Sample row:
```
:@computed_region_43wa_7qmu = undefined
:@computed_region_6mkv_f3dw = undefined
:@computed_region_bdys_3d7i = undefined
:@computed_region_du4m_ji7t = undefined
:@computed_region_rpca_8um6 = undefined
:@computed_region_vrxf_vc4k = undefined
city = "Chicago"
closed_date = "2026-08-28T15:14:43.000"
community_area = undefined
created_date = "2026-08-28T15:14:43.000"
created_day_of_week = "6"
created_department = undefined
created_hour = "15"
created_month = "8"
duplicate = false
electrical_district = undefined
electricity_grid = undefined
last_modified_date = "2026-08-28T15:14:44.000"
latitude = undefined
legacy_record = false
location = undefined
longitude = undefined
origin = "Internet"
owner_department = "Aviation"
police_beat = undefined
police_district = undefined
police_sector = undefined
precinct = undefined
sr_number = "SR26-01753319"
sr_short_code = "AVN"
sr_type = "Aircraft Noise Complaint"
state = "Illinois"
status = "Completed"
street_address = "10510 W ZEMKE RD"
street_direction = "W"
street_name = "ZEMKE"
street_number = "10510"
street_type = "RD"
ward = undefined
x_coordinate = undefined
y_coordinate = undefined
zip_code = "60666"
```
Required fields — present/populated in the 5-row sample:
- created_date: present=true, populated 5/5
- closed_date: present=true, populated 2/5
- status: present=true, populated 5/5
- sr_type: present=true, populated 5/5
- ward: present=true, populated 3/5
- community_area: present=true, populated 3/5

## 2. Closure completeness (2025)
- Total rows: 1960595
- Rows with closed_date: 1924710
- Closure rate: 98.17%
- At or above 60% — adequate.

## 3. Ward coverage (2025)
- Distinct non-null, non-zero wards: **50** of 50
- Ward list: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50
- Null-ward rows / zero-ward rows: see stdout Step 3 output of this run.

## 4. Top 25 sr_type (2025)
1. 691302 — 311 INFORMATION ONLY CALL
2. 364926 — Aircraft Noise Complaint
3. 94893 — Graffiti Removal Request
4. 52937 — Abandoned Vehicle Complaint
5. 50160 — Garbage Cart Maintenance
6. 44729 — Pothole in Street Complaint
7. 44181 — Rodent Baiting/Rat Complaint
8. 42858 — Tree Trim Request (NO LONGER BEING ACCEPTED)
9. 35939 — Street Light Out Complaint
10. 28525 — Traffic Signal Out Complaint
11. 28098 — Tree Debris Clean-Up Request
12. 26514 — Tree Emergency
13. 21782 — Blue Recycling Cart
14. 20377 — Finance Parking Code Enforcement Review
15. 19972 — Building Violation
16. 19279 — Water in Basement Complaint
17. 19198 — Tree Removal Inspection
18. 16860 — Dead Animal Pick-Up Request
19. 16465 — Yard Waste Pick-Up Request
20. 16360 — Water Lead Test Kit Request
21. 15402 — Fly Dumping Complaint
22. 14492 — Sanitation Code Violation
23. 13376 — Stray Animal Complaint
24. 13303 — Sign Repair Request - All Other Signs
25. 11494 — Check for Leak

Classified actionable (physical work with a real completion event):
- Graffiti Removal Request (94893)
- Abandoned Vehicle Complaint (52937)
- Garbage Cart Maintenance (50160)
- Pothole in Street Complaint (44729)
- Rodent Baiting/Rat Complaint (44181)
- Tree Trim Request (NO LONGER BEING ACCEPTED) (42858)
- Street Light Out Complaint (35939)
- Traffic Signal Out Complaint (28525)
- Tree Debris Clean-Up Request (28098)
- Tree Emergency (26514)
- Blue Recycling Cart (21782)
- Water in Basement Complaint (19279)
- Tree Removal Inspection (19198)
- Water Lead Test Kit Request (16360)
- Sanitation Code Violation (14492)
- Sign Repair Request - All Other Signs (13303)

Classified informational / non-actionable / unclear:
- 311 INFORMATION ONLY CALL (691302)
- Aircraft Noise Complaint (364926)
- Finance Parking Code Enforcement Review (20377)
- Building Violation (19972)
- Dead Animal Pick-Up Request (16860)
- Yard Waste Pick-Up Request (16465)
- Fly Dumping Complaint (15402)
- Stray Animal Complaint (13376)
- Check for Leak (11494)

Note: the classification is my judgement applied to the live list; the counts are live.

## 5. Response time by ward
Type analyzed: **Graffiti Removal Request** (2025 volume 94893)
Medians/p90 computed from raw row data (created_date → closed_date), not from a Socrata aggregate.

ward | n | median_days | p90_days
---|---|---|---
19 | 114 | 0.00 | 2.68
37 | 895 | 0.00 | 1.93
27 | 4197 | 0.00 | 2.94
29 | 562 | 0.03 | 1.86
26 | 2142 | 0.06 | 2.15
38 | 497 | 0.17 | 1.90
42 | 3518 | 0.22 | 2.27
30 | 1656 | 0.28 | 2.02
31 | 1285 | 0.56 | 1.94
34 | 2382 | 0.56 | 2.25
36 | 2139 | 0.63 | 2.75
28 | 2266 | 0.64 | 3.10
45 | 1701 | 0.65 | 2.25
14 | 4815 | 0.67 | 2.13
11 | 4191 | 0.68 | 2.06
24 | 1454 | 0.71 | 2.60
12 | 5608 | 0.73 | 2.49
49 | 1345 | 0.73 | 2.59
3 | 739 | 0.74 | 2.27
22 | 2671 | 0.74 | 2.72
6 | 318 | 0.75 | 2.61
44 | 2608 | 0.75 | 2.94
41 | 285 | 0.75 | 2.63
13 | 829 | 0.75 | 2.54
35 | 3420 | 0.76 | 2.76
21 | 182 | 0.76 | 2.05
25 | 4614 | 0.76 | 3.07
23 | 3214 | 0.76 | 2.67
46 | 1409 | 0.78 | 3.05
4 | 980 | 0.79 | 2.92
33 | 1735 | 0.79 | 2.99
15 | 3032 | 0.79 | 2.29
48 | 1071 | 0.79 | 2.87
16 | 1833 | 0.79 | 2.14
47 | 2260 | 0.80 | 2.92
17 | 565 | 0.80 | 2.24
32 | 4164 | 0.81 | 2.94
2 | 1234 | 0.81 | 2.90
5 | 187 | 0.81 | 2.67
43 | 3036 | 0.81 | 3.34
1 | 5583 | 0.82 | 2.88
20 | 959 | 0.83 | 2.48
8 | 240 | 0.85 | 2.84
9 | 255 | 0.89 | 2.81
40 | 1169 | 0.90 | 3.14
50 | 402 | 0.90 | 3.47
18 | 1267 | 0.91 | 2.95
39 | 1038 | 0.95 | 3.71
7 | 178 | 0.95 | 3.11
10 | 1187 | 0.97 | 2.95

- Fastest: ward 19 @ 0.00 d
- Slowest: ward 10 @ 0.97 d

Exclusions are printed explicitly in stdout Step 5. No ward was dropped for low volume.

## 6. Spread check
- slowest/fastest median ratio: 4935.00
- At or above 1.5 — real spread, the ranking carries signal.

## 7. API behaviour
- Calls: 9; non-200: 0
- Wall clock: 101.8s; no app token used
- $limit raised above the 1000 default (max used: 25000); pagination past page 1 required: yes

## Verdict
SURVIVES - closure coverage and ward spread both support a ranked leaderboard.

## Not determined (gaps, not inferred)
- Whether closed_date means "work completed" vs "ticket administratively closed/duplicate" — the dataset has a status/duplicate concept but its semantics were not validated here.
- Whether ward values are as-of-request or re-mapped after the 2023 ward remap; ward boundary changes across the year were not checked.
- Only one sr_type was profiled for response time; spread for other actionable types is unknown.
- Rows still open at query time are excluded from medians, which biases medians fast (survivorship). Not quantified.
- Rate-limit ceiling untested — this run's call volume was far too low to hit throttling.
