# Sudbury Blended Forecast

10-day blended forecast for any location (defaults to Sudbury, MA): the NWS forecast grid plus the GFS/HRRR, ECMWF, NBM, Canadian GEM, ICON and UK Met Office models, and the GFS and ECMWF ensembles (via Open-Meteo). It also has a NEXRAD radar loop. Live data loads in the browser; there's no server.

## Morning notifications

`.github/workflows/notify.yml` runs `scripts/notify.mjs` hourly. It uses the same blend as the app and publishes to an [ntfy](https://ntfy.sh) topic:

- **~6 AM daily:** the day's high/low, precipitation type, timing and amounts, wind, active NWS alerts, and a heads-up line when something notable is coming tomorrow.
- **During the day (6 AM–10 PM):** new NWS alerts, a new precipitation type, a big jump in snow totals, or damaging gusts. NWS warnings also come through overnight.

To keep the topic private, add a repo secret named `NTFY_TOPIC`; it overrides the default in the workflow.
