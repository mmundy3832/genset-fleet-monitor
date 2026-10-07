---
title: Operating ranges and raw tags for Cat G3520 and Waukesha 9394S5 gensets
date: 2026-10-07
sources:
  - https://www.ccontrols.com/support/dp/ManualEMCP4.pdf
  - https://www.warrencat.com/new/power-systems/electric-power/gas-generator-sets/g3520c-gas-generator/
  - https://www.globalpwr.com/store/natural-gas-generators/caterpillar-2000-kw-g3520c/
  - https://powergenenterprises.com/wp-content/uploads/2019/10/GS3121-Caterpillar-G3520C-GeneratorSet-Consist_Sheet.pdf
  - https://innio.com/images/medias/files/686/iwk-019012-vhp-series5-brochure-5-17-19_l.pdf
  - https://powergenenterprises.com/wp-content/uploads/2019/10/E4384-Waukesha-9390gsi-Engine-Brochure.pdf
  - https://www.globalpwr.com/pdf/gps-waukesha-7042-brochure.pdf
  - https://www.scribd.com/document/274547878/L7044GSI-7045-0710
---

## Summary

- Well sourced: EMCP 4 Modbus registers and scaling (full register table fetched); Waukesha P9394GSI S5 rating (2500 hp @ 1200 rpm) and BSFC (6972 Btu/bhp-hr LHV); G3520C 1972 ekW, 40.1% electrical efficiency, 1800 rpm.
- Not published in any fetchable source: Cat and Waukesha JW/oil/exhaust alarm and shutdown setpoints, Cat bkW and MJ/bkW-hr, Waukesha ESM register map. All of these are labeled ESTIMATE.
- Package mismatch: sourced G3520C is 1972 ekW (not 2.6 MW; 2.6 MW is a G3520H-class rating, unsourced here). 2500 bhp = 1865 kWb, so the 9394S5 yields about 1.8 MWe, not 2.0 MWe.
- Waukesha ESM tag names below are ESTIMATE (generic Waukesha/ESM vocabulary); no ESM Modbus manual was retrievable.
- Sourced fetch note: cat.com spec pages timed out; Cat data came from dealer/broker pages and the quote consist sheet.

## Caterpillar G3520

Units are SI; imperial in the comment column. "Src" codes: S1 warrencat, S2 EMCP4 manual, S3 GS3121 consist, S4 globalpwr G3520C listing, E = ESTIMATE.

| quantity | nominal | normal min | normal max | alarm | shutdown | unit | source / comment |
|---|---|---|---|---|---|---|---|
| Rated speed | 1800 | 1790 | 1810 | 1980 (110%, E) | 2070 (115%, E) | rpm | 1800 rpm 60 Hz: S1, S4. Band is E (isochronous governor). |
| Electrical output | 1972 (G3520C) / 2600 (G3520H-class, E) | 1000 | 1972 (C) / 2600 (H, E) | n/a | n/a | kWe | 1972 ekW continuous: S1. 2.6 MW not sourced. |
| Mech rating | not published | - | - | - | - | bkW | E: 1972 / 0.96 gen eff = ~2050 bkW (2750 bhp) for G3520C |
| Jacket water outlet | 99 | 90 | 99 | 104 (E) | 110 (E) | degC | E. 210 F nominal, 219 F alarm, 230 F shutdown. S3 confirms high coolant temp shutdown exists, no value. |
| Oil pressure | 400 | 350 | 450 | 280 (E) | 220 (E) | kPa | E. 58 psi nominal, 41 psi alarm, 32 psi shutdown. S3 confirms low oil pressure shutdown, no value. |
| Exhaust temp (per-cylinder port) | 500 | 450 | 540 | 580 (E) | 620 (E) | degC | E. 932 F nominal, 1076 F alarm. S3: ports wired to ITSM with alarms and shutdowns, no values. |
| Fuel flow at 100% | 16780 (C) / 21100 (H, E) | - | - | - | - | scfh | Derived, see below. |

Fuel arithmetic (G3520C): OEM figure is 40.10% max electrical efficiency (S1), not MJ/bkW-hr.
- Fuel input = 1972 kW / 0.401 = 4917 kW = 4917 * 3412 Btu/h per kW = 16.78e6 Btu/h.
- At 1000 Btu/scf: 16,780 scfh (16.78 MMBtu/hr; basis LHV vs HHV not stated by source).
- G3520H-class 2600 kWe at assumed 42% (E): 6190 kW = 21.1e6 Btu/h = 21,100 scfh.

## Waukesha 9394S5

| quantity | nominal | normal min | normal max | alarm | shutdown | unit | source / comment |
|---|---|---|---|---|---|---|---|
| Rated speed | 1200 | 1195 | 1205 | 1320 (110%, E) | 1380 (115%, E) | rpm | 1200 rpm: innio brochure (P9394GSI S5, 60 Hz class). Band E. |
| Mech rating | 2500 hp (1865 kWb) | - | - | - | - | bhp | 2500 hp @ 1200 rpm: innio brochure. kWb = 2500 * 0.7457 = 1864 (INNIO summary lists 1,400 - 1,865 kWb). |
| Electrical output | 1790 | 900 | 1790 | n/a | n/a | kWe | E: 1865 kWb * 0.96 gen eff. A 2.0 MWe package does not follow from 2500 hp. |
| Jacket water outlet | 82 | 77 | 85 | 93 (E) | 99 (E) | degC | Thermostat 175-180 F (79-82 C): E4384 (9390GSI, sibling engine). Alarms E: 200 F / 210 F. |
| Oil pressure | 380 | 340 | 450 | 210 (E) | 170 (E) | kPa | E. 55 psi nominal, 30 psi alarm, 25 psi shutdown. innio brochure confirms ESM2 oil pressure differential and permissive, no values. |
| Exhaust temp (per-cylinder) | 620 | 580 | 650 | 700 (E) | 730 (E) | degC | E. 1148 F nominal. Proxy: L7042GSI exhaust 1156 F (624 C) at full load, globalpwr 7042 brochure. ESM2 reads per-cylinder exhaust and alarms/shuts down out of range (innio brochure), no values. |
| Fuel flow at 100% | 17430 | - | - | - | - | scfh | Derived, see below. |

Fuel arithmetic: BSFC 6972 Btu/bhp-hr (-0/+5% LHV), innio brochure.
- 6972 * 2500 bhp = 17.43e6 Btu/h.
- At 1000 Btu/scf: 17,430 scfh. (Source rating basis fuel is ~900-1000 Btu/ft3; the 1000 Btu/scf is the requested assumption.)
- Implied electrical efficiency (E): 1790 kW * 3412 / 17.43e6 = 35.0%.

## Raw tag mapping

Cat registers are from the EMCP 4 SCADA Data Links manual (S2). Holding register decimal address; PDU addressing = add 40000 (e.g. 40201). Transmitted address is decimal minus 1. Multi-register values: most significant word at lowest address.

Waukesha ESM: no ESM Modbus map was retrievable. Names below are ESTIMATE; confirm against the ESM manual before presenting them as OEM names. Source for Waukesha ESM Modbus RTU slave (RS-485) existence: scribd L7044GSI spec sheet.

| canonical quantity | Cat EMCP 4 name / register / scaling | Waukesha ESM raw name / register / scaling | source |
|---|---|---|---|
| engine_speed | "Engine rpm" (Engine Speed) reg 203 (40203), 0.125 rpm/bit, offset 0 | "Engine Speed" (E), register not found | S2 |
| real_power | "Generator Total Real Power" reg 106-107 (40106), 2 regs, 1 W/bit, offset -2,000,000,000 | "Engine/Gen Power" (E), not found | S2 |
| coolant_temp | "Engine Coolant Temperature" reg 201 (40201), 0.03125 C/bit, offset -273 C | "JW Temp" / "Jacket Water Temp" (E), not found | S2 |
| oil_pressure | "Engine Oil Pressure" reg 200 (40200), 0.125 kPa/bit, offset 0 | "Oil Press" / "Lube Oil Pressure" (E), not found | S2 |
| exhaust_temp | "Exhaust Temperature" reg 801 (40801), 0.03125 C/bit, offset -273 C. Per-cylinder from data link: regs 221-240 "Cylinder #n Exhaust Port Temperature from Data Link"; manifolds 241/242 | "Cylinder n Exhaust Temp" (E), per cylinder, not found | S2 |
| fuel_flow | No EMCP 4 register (Cat GECM fuel valve not exposed) | Not exposed by ESM as flow (E); derive from load and BSFC | derived |
| energy_total | "Generator Total Real Energy Exported" reg 144-145 (40144), 2 regs, 1 kWh/bit | "kWh" (E), not found | S2 |
| frequency | "Generator Average AC RMS Frequency" reg 102, 1/128 Hz/bit | n/a (E: "Gen Freq") | S2 |
| voltage_ll | "Generator Average Line-Line AC RMS Voltage" reg 100, 1 V/bit | n/a | S2 |
| current | "Generator Average AC RMS Current" reg 101, 1 A/bit | n/a | S2 |
| power_factor | "Generator Overall Power Factor" reg 103, 1/16384 per bit, offset -1.0; lag flag reg 104 (1 = lagging) | n/a | S2 |
| run_hours | "Engine Operating Hours" reg 204-205 (40204), 2 regs, 0.05 hr/bit | "Engine Hours" (E) | S2 |
| oil_temp | "Engine Oil Temperature" reg 199, 0.03125 C/bit, offset -273 | "Lube Oil Temp" (E) | S2 |
| battery_voltage | "Battery Voltage" reg 202, 0.05 V/bit | n/a | S2 |

## Proposed schema.json ranges

SI units. Imperial equivalents are in the tables above. All G3520 numbers are for the user's 2.6 MW package assumption except where noted; G3520C sourced output is 1.972 MW. Alarm values for temperature and pressure are ESTIMATE.

```json
{
  "G3520": [
    {"tag": "engine_speed", "unit": "rpm", "nominal": 1800, "min": 1790, "max": 1810, "alarm_lo": null, "alarm_hi": 1980},
    {"tag": "real_power", "unit": "MW", "nominal": 2.4, "min": 1.0, "max": 2.6, "alarm_lo": null, "alarm_hi": 2.75},
    {"tag": "coolant_temp", "unit": "degC", "nominal": 99, "min": 90, "max": 99, "alarm_lo": null, "alarm_hi": 104},
    {"tag": "oil_pressure", "unit": "kPa", "nominal": 400, "min": 350, "max": 450, "alarm_lo": 280, "alarm_hi": null},
    {"tag": "exhaust_temp", "unit": "degC", "nominal": 500, "min": 450, "max": 540, "alarm_lo": null, "alarm_hi": 580},
    {"tag": "fuel_flow", "unit": "scfh", "nominal": 19500, "min": 9000, "max": 21100, "alarm_lo": null, "alarm_hi": null},
    {"tag": "energy_total", "unit": "MWh", "nominal": 0, "min": 0, "max": 4211081, "alarm_lo": null, "alarm_hi": null}
  ],
  "9394S5": [
    {"tag": "engine_speed", "unit": "rpm", "nominal": 1200, "min": 1195, "max": 1205, "alarm_lo": null, "alarm_hi": 1320},
    {"tag": "real_power", "unit": "MW", "nominal": 1.7, "min": 0.9, "max": 1.79, "alarm_lo": null, "alarm_hi": 1.9},
    {"tag": "coolant_temp", "unit": "degC", "nominal": 82, "min": 77, "max": 85, "alarm_lo": null, "alarm_hi": 93},
    {"tag": "oil_pressure", "unit": "kPa", "nominal": 380, "min": 340, "max": 450, "alarm_lo": 210, "alarm_hi": null},
    {"tag": "exhaust_temp", "unit": "degC", "nominal": 620, "min": 580, "max": 650, "alarm_lo": null, "alarm_hi": 700},
    {"tag": "fuel_flow", "unit": "scfh", "nominal": 16500, "min": 8500, "max": 17430, "alarm_lo": null, "alarm_hi": null},
    {"tag": "energy_total", "unit": "MWh", "nominal": 0, "min": 0, "max": 4211081, "alarm_lo": null, "alarm_hi": null}
  ]
}
```

Notes: energy_total max is the EMCP 4 register ceiling (4,211,081,215 kWh = 4,211,081 MWh); nominal 0 is a placeholder, seed per unit. The caller asked for an array per engine; the object keyed by model above holds one array per engine.
