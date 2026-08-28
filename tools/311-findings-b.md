# Chicago 311 — follow-up spike (additional actionable types)

Run 2026-08-28T23:24:11.797Z. Live queries only.
Types profiled: Abandoned Vehicle Complaint, Garbage Cart Maintenance

```

==============================================================================
TYPE: Abandoned Vehicle Complaint
==============================================================================
2025 rows: 52937 | with closed_date: 52601 | flagged duplicate: 0
status breakdown: Completed=52601  Open=336
rows fetched: 52601
EXCLUSIONS: not-completed status=0; null/zero ward=4; unparseable dates=0; negative durations=0.
Rows used for timing: 52601 of 52601 fetched. No ward excluded from the table for low volume.

-- timestamp sanity (completed rows only) --
closed_date identical to created_date (same second): 0 (0.00%)
created_date at exactly T00:00:00 (date-only granularity): 0 (0.00%)
rows flagged duplicate: 0 (0.00%)

-- distribution of days-to-close (citywide) --
  < 1 hour         931    1.8%
  1h - 1 day      7273   13.8%
  1 - 3 days      5486   10.4%
  3 - 7 days      6901   13.1%
  7 - 30 days    22232   42.3%
  30+ days        9778   18.6%
  percentiles: p10=0.173 p25=2.858 p50=10.710 p75=22.743 p90=57.726 p99=120.143 max=156.62

ward |     n |     p50 |     p75 |     p90   ("!" = n < 200, percentiles unstable)
  42 |   183 |   1.718 |  13.766 |  28.734 !
  34 |   154 |   5.982 |  15.209 |  31.170 !
  11 |  1148 |   6.682 |  13.840 |  31.254 
  13 |  1346 |   6.929 |  15.950 |  47.828 
  14 |  1485 |   7.013 |  18.949 |  57.379 
   6 |  1479 |   7.076 |  19.685 |  74.748 
  23 |  1453 |   7.167 |  15.995 |  48.076 
   5 |   570 |   7.739 |  27.883 |  62.723 
  15 |  1326 |   7.760 |  20.039 |  50.154 
  10 |  1372 |   7.863 |  17.514 |  50.056 
  12 |  1129 |   7.893 |  15.849 |  39.310 
   3 |   578 |   8.079 |  16.738 |  50.382 
   7 |  1281 |   8.144 |  19.926 |  57.652 
  37 |  1923 |   8.349 |  20.062 |  65.031 
  16 |  1897 |   8.641 |  24.590 |  69.739 
  31 |  1583 |   8.890 |  22.795 |  49.193 
  20 |  1019 |   9.135 |  29.716 |  90.232 
   4 |   686 |   9.144 |  18.028 |  54.353 
   8 |  1129 |   9.209 |  18.830 |  43.866 
   1 |   730 |   9.654 |  20.877 |  54.592 
  30 |  1521 |  10.107 |  21.062 |  42.828 
  40 |  1111 |  10.448 |  21.426 |  86.429 
  36 |  1428 |  10.653 |  22.640 |  57.780 
  27 |  1026 |  10.878 |  24.803 |  56.211 
  17 |  1360 |  11.059 |  24.759 |  55.987 
  49 |   897 |  11.271 |  30.303 |  67.043 
   9 |  1085 |  11.330 |  23.795 |  51.999 
  21 |  1168 |  11.665 |  22.893 |  56.617 
  47 |   640 |  11.742 |  23.901 |  69.872 
  38 |  1958 |  11.761 |  18.094 |  36.538 
  33 |   860 |  11.920 |  21.777 |  57.972 
  28 |  1608 |  11.983 |  29.913 |  89.397 
  18 |  1101 |  12.065 |  21.564 |  44.923 
  26 |  1080 |  12.608 |  26.472 |  51.852 
  24 |  1265 |  12.899 |  28.997 |  62.571 
  35 |   987 |  12.913 |  30.722 |  64.367 
  39 |  1315 |  12.963 |  25.090 |  55.686 
  19 |   465 |  12.966 |  24.615 |  53.622 
  41 |   955 |  13.395 |  22.668 |  35.676 
  50 |  1049 |  13.663 |  28.186 |  70.622 
  25 |   757 |  13.723 |  25.666 |  67.946 
  45 |  1315 |  13.869 |  22.786 |  44.676 
  22 |  1119 |  13.883 |  28.072 |  65.243 
  32 |  1097 |  13.901 |  24.162 |  53.881 
  29 |  1395 |  14.896 |  27.535 |  55.052 
  46 |   415 |  15.619 |  41.933 |  62.167 
   2 |   116 |  19.992 |  32.007 |  49.597 !
  48 |   490 |  20.047 |  43.017 |  65.670 
  43 |   299 |  20.954 |  33.610 |  55.990 
  44 |   244 |  22.801 |  40.039 |  61.970 

Endpoints drawn from the 47 wards with n >= 200; 3 thinner ward(s) shown in the table but not used as headline fastest/slowest.
fastest ward 11: p50=6.682  p90=31.254 (n=1148)
slowest ward 44: p50=22.801  p90=61.970 (n=244)
median ratio (slowest/fastest p50): 3.41
median ABSOLUTE gap: 16.118 days (386.8 hours)  <-- the honest headline number
p90 ENDPOINT ratio (slowest-ward p90 / fastest-ward p90, both by median): 1.98
p90 RANGE  ratio (max p90 / min p90 across wards): 31.25 to 90.23 days = 2.89

>> Ward spread is 16.1 days end to end — large enough for a reader to care about.

==============================================================================
TYPE: Garbage Cart Maintenance
==============================================================================
2025 rows: 50160 | with closed_date: 49863 | flagged duplicate: 1416
status breakdown: Completed=49074  Canceled=789  Open=297
rows fetched: 49863
EXCLUSIONS: not-completed status=789 (Canceled=789); null/zero ward=5; unparseable dates=0; negative durations=0.
Rows used for timing: 49074 of 49863 fetched. No ward excluded from the table for low volume.

-- timestamp sanity (completed rows only) --
closed_date identical to created_date (same second): 0 (0.00%)
created_date at exactly T00:00:00 (date-only granularity): 0 (0.00%)
rows flagged duplicate: 1403 (2.86%)

-- distribution of days-to-close (citywide) --
  < 1 hour         123    0.3%
  1h - 1 day      1950    4.0%
  1 - 3 days      2796    5.7%
  3 - 7 days      5040   10.3%
  7 - 30 days    20960   42.7%
  30+ days       18205   37.1%
  percentiles: p10=3.012 p25=9.741 p50=23.119 p75=36.945 p90=47.889 p99=62.162 max=149.12

ward |     n |     p50 |     p75 |     p90   ("!" = n < 200, percentiles unstable)
  13 |  1278 |  17.811 |  29.415 |  41.690 
  44 |   261 |  18.834 |  34.073 |  51.779 
  38 |  1449 |  19.787 |  32.993 |  42.766 
  30 |  1432 |  19.813 |  33.822 |  44.460 
   3 |   365 |  19.900 |  35.958 |  44.567 
  20 |   833 |  20.565 |  33.834 |  45.831 
  45 |  1136 |  20.602 |  33.873 |  43.933 
   6 |  1489 |  20.883 |  34.704 |  46.821 
  41 |  1331 |  20.886 |  34.138 |  43.740 
  50 |   813 |  21.036 |  35.579 |  45.048 
   4 |   314 |  21.205 |  32.726 |  41.862 
  40 |   671 |  21.724 |  39.839 |  50.143 
  24 |  1219 |  21.868 |  35.655 |  47.773 
  25 |   717 |  21.869 |  37.866 |  49.827 
  29 |  1272 |  22.019 |  35.002 |  44.832 
  19 |  1721 |  22.144 |  34.859 |  43.880 
  43 |   347 |  22.343 |  33.249 |  46.433 
  23 |  1327 |  22.529 |  37.954 |  45.836 
  11 |   922 |  22.612 |  38.071 |  49.929 
  42 |    47 |  22.745 |  36.370 |  48.559 !
  21 |  2174 |  22.746 |  34.047 |  43.047 
  35 |   968 |  22.795 |  38.840 |  50.718 
   5 |   298 |  22.804 |  35.849 |  48.785 
  34 |    70 |  23.009 |  33.947 |  47.892 !
  37 |  1385 |  23.112 |  37.856 |  48.143 
   1 |   708 |  23.324 |  38.307 |  49.608 
  18 |  2056 |  23.707 |  35.773 |  46.752 
  14 |   980 |  23.742 |  40.549 |  48.163 
   7 |  1420 |  23.815 |  37.183 |  46.953 
  10 |  1334 |  23.893 |  37.018 |  48.874 
   9 |  1879 |  23.960 |  36.621 |  45.780 
  27 |   914 |  24.537 |  39.504 |  51.145 
  22 |   915 |  24.853 |  41.368 |  51.786 
  26 |  1014 |  24.900 |  38.990 |  49.706 
  32 |   708 |  25.641 |  39.704 |  47.804 
  39 |  1081 |  25.701 |  41.668 |  50.667 
   8 |  1522 |  25.793 |  38.163 |  49.001 
  28 |  1120 |  25.917 |  38.991 |  48.963 
  49 |   219 |  26.021 |  38.244 |  45.916 
  16 |  1724 |  26.618 |  37.937 |  47.980 
  31 |  1138 |  26.657 |  40.002 |  49.926 
  36 |  1183 |  26.673 |  41.000 |  50.717 
  47 |   644 |  26.715 |  40.968 |  49.979 
  17 |  1557 |  26.725 |  37.923 |  48.006 
  15 |  1108 |  27.500 |  40.666 |  49.670 
  33 |   759 |  27.904 |  41.921 |  52.533 
  48 |   180 |  29.011 |  41.977 |  47.957 !
  12 |   812 |  29.931 |  43.540 |  54.020 
   2 |   185 |  31.252 |  47.901 |  56.395 !
  46 |    70 |  32.911 |  43.499 |  50.960 !

Endpoints drawn from the 45 wards with n >= 200; 5 thinner ward(s) shown in the table but not used as headline fastest/slowest.
fastest ward 13: p50=17.811  p90=41.690 (n=1278)
slowest ward 12: p50=29.931  p90=54.020 (n=812)
median ratio (slowest/fastest p50): 1.68
median ABSOLUTE gap: 12.120 days (290.9 hours)  <-- the honest headline number
p90 ENDPOINT ratio (slowest-ward p90 / fastest-ward p90, both by median): 1.30
p90 RANGE  ratio (max p90 / min p90 across wards): 41.69 to 54.02 days = 1.30

>> Ward spread is 12.1 days end to end — large enough for a reader to care about.

==============================================================================
CROSS-TYPE SUMMARY
==============================================================================
type | completed rows | fastest p50 | slowest p50 | abs gap (days) | p90 endpoint ratio | p90 range ratio | same-second closes
Abandoned Vehicle Complaint | 52601 | 6.682 | 22.801 | 16.118 | 1.98 | 2.89 | 0.0%
Garbage Cart Maintenance | 49074 | 17.811 | 29.931 | 12.120 | 1.30 | 1.30 | 0.0%

==============================================================================
WARD VOLUME ANOMALY CHECK (facility-address stamping)
==============================================================================

FLAGGED  311 INFORMATION ONLY CALL: 662333 of 691302 rows (95.81%) sit in ward 28; next ward 21 has 1370.
         top address in ward 28: "2111 W Lexington ST" with 662321 rows (next: "2111 W LEXINGTON ST" with 6) — a single facility, not resident demand.
         ward 28 2025 total: 686424; excluding this type: 24091 (a typical ward is ~20k).

FLAGGED  Aircraft Noise Complaint: 364901 of 364926 rows (99.99%) sit in ward 41; next ward 13 has 4.
         top address in ward 41: "10510 W ZEMKE RD" with 364900 rows (next: "6598 N ONARGA" with 1) — a single facility, not resident demand.
         ward 41 2025 total: 382774; excluding this type: 17873 (a typical ward is ~20k).
OK       Graffiti Removal Request: 94893 rows, top ward 12 holds 5.9% — no concentration.
OK       Abandoned Vehicle Complaint: 52937 rows, top ward 38 holds 3.7% — no concentration.
OK       Garbage Cart Maintenance: 50160 rows, top ward 21 holds 4.4% — no concentration.

>> Consequence: per-ward VOLUME metrics must exclude the flagged facility-stamped
>> types (or restrict to actionable sr_types). Response-time figures above are
>> unaffected: flagged types are non-actionable and already excluded from timing.

HTTP attempts: 19 (retries 0, timeouts 0); non-200: 0
Wall clock: 89.8s
```
