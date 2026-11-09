#!/bin/bash
# Temporary: probes climate data APIs from the runner and saves raw responses.
set -u
mkdir -p /tmp/probe && cd /tmp/probe
O="Origin: https://richwilmot323-tech.github.io"
T=$(date +%F)
A=https://data.rcc-acis.org
curl -s -m 60 "$A/StnMeta?bbox=-71.95,42.05,-70.85,42.75&elems=pcpn,snow,maxt,mint&meta=name,sids,ll,valid_daterange" -o meta.json
curl -s -m 60 -D cors_acis.txt -o /dev/null -H "$O" "$A/StnMeta?bbox=-71.5,42.3,-71.3,42.5&elems=pcpn"
curl -s -m 60 -D cors_acis_post.txt -o /dev/null -X OPTIONS -H "$O" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" "$A/StnData"
for SID in BOSthr ORHthr 190535 BED; do
  curl -s -m 90 -X POST -H "Content-Type: application/json" -d "{\"sid\":\"$SID\",\"sdate\":\"2026-01-01\",\"edate\":\"$T\",\"meta\":\"name,sids,ll\",\"elems\":[{\"name\":\"maxt\"},{\"name\":\"mint\"},{\"name\":\"avgt\"},{\"name\":\"pcpn\"},{\"name\":\"snow\"},{\"name\":\"maxt\",\"normal\":\"1\"},{\"name\":\"mint\",\"normal\":\"1\"},{\"name\":\"avgt\",\"normal\":\"1\"},{\"name\":\"pcpn\",\"normal\":\"1\"},{\"name\":\"snow\",\"normal\":\"1\"}]}" "$A/StnData" -o "daily_$SID.json"
  curl -s -m 90 -X POST -H "Content-Type: application/json" -d "{\"sid\":\"$SID\",\"sdate\":\"por\",\"edate\":\"$T\",\"elems\":[{\"name\":\"pcpn\",\"interval\":[1,0,0],\"duration\":\"std\",\"season_start\":\"01-01\",\"reduce\":{\"reduce\":\"sum\",\"add\":\"mcnt\"},\"maxmissing\":10},{\"name\":\"snow\",\"interval\":[1,0,0],\"duration\":\"std\",\"season_start\":\"07-01\",\"reduce\":{\"reduce\":\"sum\",\"add\":\"mcnt\"},\"maxmissing\":10},{\"name\":\"avgt\",\"interval\":[1,0,0],\"duration\":\"std\",\"season_start\":\"01-01\",\"reduce\":{\"reduce\":\"mean\",\"add\":\"mcnt\"},\"maxmissing\":10}]}" "$A/StnData" -o "rank_$SID.json"
done
I=https://mesonet.agron.iastate.edu
curl -s -m 90 -D cors_iem.txt -H "$O" "$I/cgi-bin/request/asos.py?station=BED&data=wxcodes&data=p01i&year1=2026&month1=1&day1=1&year2=2026&month2=3&day2=1&tz=America%2FNew_York&format=onlycomma&latlon=no&missing=M&trace=T&report_type=3&report_type=4" -o asos_bed.csv
curl -s -m 60 -D cors_iem_json.txt -H "$O" "$I/json/stations.py?network=MA_ASOS" -o iem_ma_asos.json
curl -s -m 60 -D cors_iem_api.txt -H "$O" "$I/api/1/daily.json?station=BED&network=MA_ASOS&year=2026" -o iem_daily.json
ls -la
