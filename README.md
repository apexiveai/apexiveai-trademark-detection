# Apexive AI Trademark Conflict Detector

## Run the backend

From the `backend\` directory:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8017 --reload
```

## Visual comparison

The comparison API supports PDF, XLSX/XLSM, SVG, PNG, JPG/JPEG, and WebP
uploads. PDF pages are rendered so vector logos can be compared as well as
embedded images. Spreadsheet comparisons use embedded raster images.
Standalone SVG logos are rasterized for visual comparison.

Logo similarity is a preliminary image heuristic, not a trained logo
recognition system or a legal assessment. It may not reliably detect rotated,
cropped, recolored, or semantically similar logos.

## Run backend tests

From the `backend\` directory:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```
