# Sudbury Blended Forecast

10-day blended forecast for any location (defaults to Sudbury, MA): the NWS forecast grid plus the GFS/HRRR, ECMWF, NBM, Canadian GEM, ICON and UK Met Office models, and the GFS and ECMWF ensembles (via Open-Meteo). It also has a NEXRAD radar loop. Live data loads in the browser; there's no server.

## Morning notifications

`.github/workflows/notify.yml` runs `scripts/notify.mjs` hourly. It uses the same blend as the app and publishes to an [ntfy](https://ntfy.sh) topic:

- **~6 AM daily:** the day's high/low, precipitation type, timing and amounts, wind, active NWS alerts, and a heads-up line when something notable is coming tomorrow.
- **During the day (6 AM–10 PM):** new NWS alerts, a new precipitation type, a big jump in snow totals, or damaging gusts. NWS warnings also come through overnight.

To keep the topic private, add a repo secret named `NTFY_TOPIC`; it overrides the default in the workflow.

## Pressure map

`.github/workflows/synoptic.yml` runs `scripts/synoptic.mjs` every 6 hours. It pulls GFS sea-level pressure, 6-hour precipitation and 250 mb winds on a 2.5° grid from the central Pacific to the western Atlantic (~900 points, 10 days, 6-hourly). It then detects highs and lows, links them into tracks, and force-pushes `synoptic.json` to the `data` branch. The app's Pressure tab reads it from raw.githubusercontent.com.

## Climate tab

Observed precipitation, snow and temperature vs. 1991–2020 normals from NOAA stations via RCC-ACIS (called from the browser). For each measurement the app uses the nearest station with a long, complete record and normals. Rankings compare the same dates in every year of that station's record. Ice (freezing rain/sleet days and hours) comes from the nearest airport's hourly reports in the IEM ASOS archive, compared with the same dates over the previous 10 years.
