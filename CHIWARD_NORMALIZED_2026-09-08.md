# ChiWardBoard — normalized analysis, 2026-09-08

Read-only pass. No site files changed. Numbers only.


## Phase 0 — source discovery

**The Socrata route is dead.** The Street Center Lines layer is listed on the City of Chicago
data portal but is not retrievable through any Socrata access method:

| Attempt | Result |
| --- | --- |
| `6imu-meau` SODA JSON, `$limit=1` | HTTP 200, 5 bytes — `[{}]`, rows with no properties |
| `6imu-meau` GeoJSON export | HTTP 200, 53 bytes — truncated at `"features": [` |
| `6imu-meau` shapefile download | HTTP 404 (505,806-byte HTML error page) |
| `sz6q-f34c` (deprecated 2016) GeoJSON export | HTTP 200, 53 bytes — same truncation |
| `fiya-x94p` (deprecated 2014) GeoJSON export | HTTP 200, 53 bytes — same truncation |
| Socrata catalog metadata for `6imu-meau` | `columns_field_name: []` — no schema exposed |

**Source used instead**, by approval:

```
https://gisapps.chicago.gov/arcgis/rest/services/ExternalApps/Centerline/MapServer/0
```
Layer 0 `Transportation`, esriGeometryPolyline, source SR 102671 (State Plane IL East, ftUS),
`maxRecordCount` 2000, `supportsPagination` true, `supportsStatistics` true.
Total features, unfiltered: **56,385**. Total length, unfiltered: **4,495.4 mi** (sum of `SHAPE.LEN` / 5280).

Length field present: `LENGTH` (double) and `SHAPE.LEN` (double). **No ward field** — the layer carries
ZIP, census block and FIPS but no ward, so ward attribution is by spatial join only.

### Alleys

**Not separable within CLASS 4, because the layer contains no alleys at all.** CLASS 4 (37,857 segments,
3,091.1 mi) breaks down by `STREET_TYPE` as AVE 18,792 / ST 15,221 / PL 1,727 / DR 649 / BLVD 647 and a
blank-type remainder — all named streets. Across the whole layer there are 24 distinct `STREET_TYPE`
values (AVE, ST, PL, EXPY, DR, RD, BLVD, blank, ER, XR, PKWY, ORD, CT, TER, RL, HWY, SR, LN, PLZ, WAY,
SQ, TOLL, CRES, ROW) and none is `ALY`/`ALLEY`. Chicago's alley network is absent from this layer, so
there is no with-alleys / without-alleys pair to carry through. Class used as-is.

*(A `LIKE '%ALLEY%'` probe returned an Akamai `Access Denied` page — a WAF block on the wildcard string,
not a data result. The `STREET_TYPE` groupBy above is the evidence.)*

### Filter applied

`CLASS IN ('1','2','3','4','5','7','9') AND STATUS NOT IN ('P','UC','V')` — 53,771 segments returned.

### Reconciliation to the 4,495.4 unfiltered figure

| Step | Miles | Query |
| --- | ---: | --- |
| All classes, all statuses | 4,495.4 | `where=1=1`, groupBy CLASS, sum SHAPE.LEN |
| less excluded classes (RIV 45.9, E 78.9, 99 87.0, S 0.4, blank 0.5) | −212.7 | same query |
| = kept classes, all statuses | 4,282.7 | `CLASS IN (...)`, sum SHAPE.LEN (54,377 segs) |
| less excluded statuses P/UC/V within kept classes | −41.3 | `CLASS IN (...) AND STATUS IN ('P','UC','V')` (605 segs) |
| = filtered set fetched | 4,241.3 | 53,771 segments |
| less length falling outside all 50 ward polygons | −42.0 | clip result |
| **= allocated to wards** | **4,199.3** | clip result |

### Clip method

Geometry pulled in EPSG:4326 (`outSR=4326`, `geometryPrecision=6`), 27 pages of 2000. Each polyline is
walked vertex-pair by vertex-pair; where a pair's endpoints fall in different wards the pair is
recursively bisected until both ends agree or the span is under 1e-5° (~1.1 m), max depth 18. No
whole-segment midpoint assignment. Per-ward geodesic sub-lengths are then converted to shares of that
segment's authoritative `SHAPE.LEN`, so the ward totals sum back to the layer's own length field rather
than to a recomputed geodesic total. Ward polygons: repo `data/wards.geojson`, 50 MultiPolygon features.
Segments with zero usable geometry: 0.


## Phase 1 — road centerline miles per ward

All 50 wards have a value. Sum 4,199.3 mi. Median 77.2, mean 84.0.
Range: **ward 2 = 29.5 mi** (min) to **ward 21 = 165.7 mi** (max).

| Ward | Road mi | Ward area sq mi | Road mi per sq mi |
| ---: | ---: | ---: | ---: |
| 1 | 61.5 | 2.36 | 26.0 |
| 2 | 29.5 | 1.12 | 26.2 |
| 3 | 77.5 | 3.51 | 22.1 |
| 4 | 76.9 | 4.15 | 18.5 |
| 5 | 70.3 | 4.02 | 17.5 |
| 6 | 116.0 | 5.00 | 23.2 |
| 7 | 92.9 | 5.08 | 18.3 |
| 8 | 129.2 | 6.46 | 20.0 |
| 9 | 148.0 | 8.42 | 17.6 |
| 10 | 154.5 | 20.72 | 7.5 |
| 11 | 95.1 | 4.56 | 20.8 |
| 12 | 78.1 | 4.79 | 16.3 |
| 13 | 92.5 | 5.30 | 17.5 |
| 14 | 74.3 | 4.35 | 17.1 |
| 15 | 62.9 | 2.99 | 21.1 |
| 16 | 100.5 | 4.52 | 22.2 |
| 17 | 96.0 | 4.67 | 20.5 |
| 18 | 123.6 | 6.94 | 17.8 |
| 19 | 140.5 | 7.90 | 17.8 |
| 20 | 113.4 | 5.23 | 21.7 |
| 21 | 165.7 | 7.60 | 21.8 |
| 22 | 59.2 | 3.79 | 15.6 |
| 23 | 85.8 | 4.21 | 20.4 |
| 24 | 85.8 | 4.02 | 21.4 |
| 25 | 64.2 | 3.35 | 19.2 |
| 26 | 59.3 | 2.79 | 21.3 |
| 27 | 132.9 | 5.72 | 23.2 |
| 28 | 116.7 | 5.75 | 20.3 |
| 29 | 81.0 | 4.27 | 19.0 |
| 30 | 81.7 | 3.41 | 23.9 |
| 31 | 57.0 | 2.67 | 21.4 |
| 32 | 75.6 | 3.34 | 22.7 |
| 33 | 48.6 | 2.23 | 21.8 |
| 34 | 47.4 | 1.53 | 30.9 |
| 35 | 67.0 | 2.74 | 24.5 |
| 36 | 68.7 | 3.01 | 22.8 |
| 37 | 69.1 | 3.60 | 19.2 |
| 38 | 100.1 | 6.37 | 15.7 |
| 39 | 118.8 | 6.54 | 18.2 |
| 40 | 62.8 | 3.47 | 18.1 |
| 41 | 146.0 | 17.07 | 8.6 |
| 42 | 51.0 | 1.88 | 27.1 |
| 43 | 47.6 | 2.23 | 21.3 |
| 44 | 35.5 | 1.70 | 20.9 |
| 45 | 113.8 | 5.00 | 22.7 |
| 46 | 34.7 | 2.01 | 17.3 |
| 47 | 63.7 | 3.04 | 20.9 |
| 48 | 32.6 | 1.62 | 20.2 |
| 49 | 36.8 | 1.83 | 20.1 |
| 50 | 57.2 | 2.67 | 21.4 |

Density median 20.7 road mi per sq mi. Flagged as implausible-looking against land area:

- **Ward 10 — 7.5** (154.5 mi over 20.72 sq mi). Lowest density in the city.
- **Ward 41 — 8.6** (146.0 mi over 17.07 sq mi). Second lowest.
- Next lowest are ward 22 at 15.6 and ward 38 at 15.7, roughly double those two.
- Highest: ward 34 at 30.9, ward 42 at 27.1, ward 2 at 26.2, ward 1 at 26.0.

The area denominator is the full ward polygon, which includes water and non-residential land; wards 10
and 41 are the two wards whose polygons carry the largest such areas. No road-mile figure was adjusted.


## Phase 2 — 311 figures per ward

Source: `data/leaderboard.json`, the snapshot the site serves. Period **September 2025 to August 2026**
(`2025-09-01` to `2026-09-01`, exclusive). Requests = the ward's `nAll`, i.e. all requests of that type
attributed to the ward after the city's duplicate flag is excluded. Median days to close = `p50`,
Kaplan-Meier with still-open requests carried as censored observations.

| Type | Requests | Duplicates excluded | Timed rows | Still open at pull |
| --- | ---: | ---: | ---: | ---: |
| Pothole in Street Complaint | 58,227 | 20,802 | 31,685 | 5,520 |
| Street Light Out Complaint | 36,036 | 4,676 | 30,157 | 1,077 |

| Ward | Road mi | Pothole req | Pothole req/mi | Pothole days | Light req | Light req/mi | Light days |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 61.5 | 562 | 9.1 | 26.8 | 518 | 8.4 | 1.7 |
| 2 | 29.5 | 506 | 17.1 | 6.9 | 294 | 10.0 | 4.8 |
| 3 | 77.5 | 542 | 7.0 | 4.4 | 692 | 8.9 | 2.5 |
| 4 | 76.9 | 496 | 6.5 | 5.7 | 551 | 7.2 | 2.8 |
| 5 | 70.3 | 587 | 8.4 | 10.1 | 451 | 6.4 | 3.4 |
| 6 | 116.0 | 780 | 6.7 | 3.0 | 792 | 6.8 | 3.5 |
| 7 | 92.9 | 508 | 5.5 | 1.9 | 768 | 8.3 | 2.6 |
| 8 | 129.2 | 827 | 6.4 | 1.9 | 1051 | 8.1 | 2.6 |
| 9 | 148.0 | 1076 | 7.3 | 3.1 | 1308 | 8.8 | 2.7 |
| 10 | 154.5 | 764 | 4.9 | 3.8 | 1357 | 8.8 | 2.4 |
| 11 | 95.1 | 868 | 9.1 | 5.9 | 778 | 8.2 | 1.7 |
| 12 | 78.1 | 810 | 10.4 | 6.6 | 658 | 8.4 | 2.6 |
| 13 | 92.5 | 890 | 9.6 | 9.0 | 536 | 5.8 | 2.9 |
| 14 | 74.3 | 642 | 8.6 | 10.0 | 522 | 7.0 | 2.7 |
| 15 | 62.9 | 641 | 10.2 | 7.9 | 689 | 11.0 | 2.6 |
| 16 | 100.5 | 655 | 6.5 | 7.6 | 606 | 6.0 | 4.7 |
| 17 | 96.0 | 754 | 7.9 | 3.8 | 676 | 7.0 | 3.2 |
| 18 | 123.6 | 1281 | 10.4 | 6.0 | 855 | 6.9 | 2.8 |
| 19 | 140.5 | 1315 | 9.4 | 3.8 | 849 | 6.0 | 2.7 |
| 20 | 113.4 | 576 | 5.1 | 12.2 | 699 | 6.2 | 3.4 |
| 21 | 165.7 | 942 | 5.7 | 4.2 | 1401 | 8.5 | 3.1 |
| 22 | 59.2 | 553 | 9.3 | 7.0 | 631 | 10.7 | 2.3 |
| 23 | 85.8 | 796 | 9.3 | 8.7 | 667 | 7.8 | 1.9 |
| 24 | 85.8 | 421 | 4.9 | 58.1 | 674 | 7.9 | 2.6 |
| 25 | 64.2 | 604 | 9.4 | 18.9 | 715 | 11.1 | 1.8 |
| 26 | 59.3 | 431 | 7.3 | 29.6 | 484 | 8.2 | 1.8 |
| 27 | 132.9 | 995 | 7.5 | 21.9 | 806 | 6.1 | 2.3 |
| 28 | 116.7 | 770 | 6.6 | 25.1 | 773 | 6.6 | 2.8 |
| 29 | 81.0 | 541 | 6.7 | 23.1 | 617 | 7.6 | 2.1 |
| 30 | 81.7 | 745 | 9.1 | 19.0 | 568 | 7.0 | 1.9 |
| 31 | 57.0 | 565 | 9.9 | 16.0 | 466 | 8.2 | 1.7 |
| 32 | 75.6 | 944 | 12.5 | 28.5 | 452 | 6.0 | 2.0 |
| 33 | 48.6 | 723 | 14.9 | 9.8 | 289 | 5.9 | 2.2 |
| 34 | 47.4 | 469 | 9.9 | 4.0 | 408 | 8.6 | 3.5 |
| 35 | 67.0 | 712 | 10.6 | 15.1 | 499 | 7.4 | 1.9 |
| 36 | 68.7 | 720 | 10.5 | 16.6 | 486 | 7.1 | 1.8 |
| 37 | 69.1 | 517 | 7.5 | 23.1 | 501 | 7.3 | 2.6 |
| 38 | 100.1 | 809 | 8.1 | 14.0 | 816 | 8.2 | 2.1 |
| 39 | 118.8 | 1193 | 10.0 | 17.5 | 621 | 5.2 | 2.3 |
| 40 | 62.8 | 767 | 12.2 | 5.5 | 432 | 6.9 | 2.7 |
| 41 | 146.0 | 1273 | 8.7 | 16.8 | 701 | 4.8 | 2.6 |
| 42 | 51.0 | 1088 | 21.3 | 2.1 | 542 | 10.6 | 3.8 |
| 43 | 47.6 | 865 | 18.2 | 5.1 | 532 | 11.2 | 4.6 |
| 44 | 35.5 | 398 | 11.2 | 7.9 | 254 | 7.1 | 2.6 |
| 45 | 113.8 | 1057 | 9.3 | 15.9 | 741 | 6.5 | 2.0 |
| 46 | 34.7 | 409 | 11.8 | 9.9 | 240 | 6.9 | 2.7 |
| 47 | 63.7 | 960 | 15.1 | 4.9 | 443 | 7.0 | 2.4 |
| 48 | 32.6 | 546 | 16.7 | 6.0 | 291 | 8.9 | 3.6 |
| 49 | 36.8 | 510 | 13.9 | 8.5 | 240 | 6.5 | 3.5 |
| 50 | 57.2 | 627 | 11.0 | 6.0 | 286 | 5.0 | 2.5 |

Pothole requests per road mile: min ward 24 = 4.9, median 9.3, max ward 42 = 21.3.
Pothole median days: min ward 8 = 1.9, median 8.2, max ward 24 = 58.1.
Street light requests per road mile: min ward 41 = 4.8, median 7.2, max ward 43 = 11.2.
Street light median days: min ward 31 = 1.7, median 2.6, max ward 2 = 4.8.


## Phase 3 — relationships

n = 50 wards in every pair.

| Pair | Pearson | Spearman |
| --- | ---: | ---: |
| Pothole requests/mile vs pothole median days | -0.25 | -0.03 |
| Street light requests/mile vs street light median days | +0.14 | -0.04 |
| Pothole requests/mile vs street light requests/mile | +0.25 | +0.01 |
| *(reference)* pothole median days vs street light median days | -0.37 | -0.48 |

Stated plainly, without interpretation:

- Within potholes, requests per road mile against median days to close is **−0.25 Pearson, −0.03
  Spearman**. The rank correlation is effectively zero; the Pearson value is weak and negative.
- Within street lights, the same pair is **+0.14 Pearson, −0.04 Spearman**. Both are effectively zero,
  and they carry opposite signs.
- A ward's rank on pothole requests per mile against its rank on street light requests per mile is
  **+0.01 Spearman** (+0.25 Pearson). The rank relationship is absent.
- The reference row is included because it is the only pair among the four with a non-trivial rank
  relationship: **−0.48 Spearman**.


## Phase 4 — west side and south side on normalized figures

Groupings are the ones used in the raw finding, stated explicitly:

- west = wards 1, 24, 26, 27, 28, 29, 37
- south = wards 6, 7, 8, 9, 10, 21

| Type | Group | Median days | Median req/mi | Median road mi | Median requests |
| --- | --- | ---: | ---: | ---: | ---: |
| Pothole | west | 25.1 | 7.3 | 81.0 | 541 |
| Pothole | south | 3.0 | 6.0 | 138.6 | 804 |
| Street light | west | 2.3 | 7.6 | 81.0 | 617 |
| Street light | south | 2.6 | 8.4 | 138.6 | 1180 |

**Pothole.** The raw finding was 25.1 days west against 3.0 days south, a ratio of 8.3x. That is
unchanged here — those are the same two medians. Normalizing by road mileage does not touch it: west
median 7.3 requests per road mile against south 6.0, a ratio of **1.20x**. The west-side wards carry
fewer road miles (median 81.0 against 138.6) and file fewer pothole requests in absolute terms (median
541 against 804), and after dividing by road mileage their request density is 20% higher than the south
side while their median close time is 8.3 times longer.

**Street light.** west median 2.3 days against south 2.6 days, ratio 0.9x. Requests per road mile: west
7.6 against south 8.4, ratio 0.91x. Neither the raw nor the normalized figure separates the two groups
on this type.

Per-ward detail, pothole:

| Ward | Group | Road mi | Requests | Req/mi | Median days |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1 | west | 61.5 | 562 | 9.1 | 26.8 |
| 24 | west | 85.8 | 421 | 4.9 | 58.1 |
| 26 | west | 59.3 | 431 | 7.3 | 29.6 |
| 27 | west | 132.9 | 995 | 7.5 | 21.9 |
| 28 | west | 116.7 | 770 | 6.6 | 25.1 |
| 29 | west | 81.0 | 541 | 6.7 | 23.1 |
| 37 | west | 69.1 | 517 | 7.5 | 23.1 |
| 6 | south | 116.0 | 780 | 6.7 | 3.0 |
| 7 | south | 92.9 | 508 | 5.5 | 1.9 |
| 8 | south | 129.2 | 827 | 6.4 | 1.9 |
| 9 | south | 148.0 | 1076 | 7.3 | 3.1 |
| 10 | south | 154.5 | 764 | 4.9 | 3.8 |
| 21 | south | 165.7 | 942 | 5.7 | 4.2 |

The normalization leaves the pothole picture intact.

