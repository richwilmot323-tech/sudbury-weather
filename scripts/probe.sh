#!/bin/bash
set -u
mkdir -p /tmp/probe && cd /tmp/probe
T=$(date +%F); MD=$(date +%m-%d)
A=https://data.rcc-acis.org
curl -s -m 120 "$A/StnMeta?bbox=-71.95,42.05,-70.85,42.75&elems=pcpn,snow,maxt,mint&meta=name,sids,ll,valid_daterange" -o meta.json
post(){ curl -s -m 120 -X POST -H "Content-Type: application/json" -d "$2" "$A/StnData" -o "$1"; }
post rank_std.json "{\"sid\":\"BED\",\"sdate\":\"1940-$MD\",\"edate\":\"$T\",\"elems\":[{\"name\":\"pcpn\",\"interval\":[1,0,0],\"duration\":\"std\",\"season_start\":\"01-01\",\"reduce\":{\"reduce\":\"sum\",\"add\":\"mcnt\"},\"maxmissing\":15},{\"name\":\"avgt\",\"interval\":[1,0,0],\"duration\":\"std\",\"season_start\":\"01-01\",\"reduce\":{\"reduce\":\"mean\",\"add\":\"mcnt\"},\"maxmissing\":15}]}"
post rank_days.json "{\"sid\":\"BED\",\"sdate\":\"1940-$MD\",\"edate\":\"$T\",\"elems\":[{\"name\":\"pcpn\",\"interval\":[1,0,0],\"duration\":60,\"reduce\":{\"reduce\":\"sum\",\"add\":\"mcnt\"},\"maxmissing\":6}]}"
post milford.json "{\"sid\":\"194760\",\"sdate\":\"2025-11-01\",\"edate\":\"$T\",\"meta\":\"name,sids,ll\",\"elems\":[{\"name\":\"snow\"},{\"name\":\"snow\",\"normal\":\"1\"},{\"name\":\"pcpn\"},{\"name\":\"pcpn\",\"normal\":\"1\"},{\"name\":\"maxt\"},{\"name\":\"maxt\",\"normal\":\"1\"}]}"
post milford_rank.json "{\"sid\":\"194760\",\"sdate\":\"1900-$MD\",\"edate\":\"$T\",\"elems\":[{\"name\":\"snow\",\"interval\":[1,0,0],\"duration\":\"std\",\"season_start\":\"07-01\",\"reduce\":{\"reduce\":\"sum\",\"add\":\"mcnt\"},\"maxmissing\":15}]}"
post bed_old.json "{\"sid\":\"BED\",\"sdate\":\"2025-01-01\",\"edate\":\"2025-03-01\",\"elems\":[{\"name\":\"snow\"},{\"name\":\"snow\",\"normal\":\"1\"},{\"name\":\"pcpn\",\"normal\":\"1\"}]}"
ls -la
