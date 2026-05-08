# Screen Planner

A browser-based 2D monitor layout planning tool. Drag monitors onto a canvas, configure sizes and resolutions, add usage labels, and compare two desk setups side by side — no server required.

---

## Getting Started

Open `index.html` directly in any modern browser. No build step or server is needed.

---

## Features

### Monitor Catalog
- Built-in catalog covering common sizes: **21", 24", 27", 32", 43", 49", 65"**
- Reference models from Dell, LG, EIZO, and Philips with real-world physical dimensions (mm)
- Each monitor entry includes panel type, aspect ratio, PiP support flag, and available resolutions
- **Custom monitors** can be added via the sidebar. Custom entries are saved to `localStorage` and persist across sessions

**Built-in models include:**

| Model | Size | Panel | Aspect | Max Resolution |
|---|---|---|---|---|
| Dell UltraSharp U2412M | 24" | IPS | 16:10 | 1920 × 1200 |
| EIZO EV2450 | 24" | IPS | 16:9 | 1920 × 1080 |
| Dell UltraSharp U2725QE | 27" | IPS | 16:9 | 3840 × 2160 |
| Dell UltraSharp U3223QE | 32" | IPS | 16:9 | 3840 × 2160 |
| Eizo Raptor RP4325-008 | 43" | IPS | 16:9 | 3840 × 2160 |
| LG 43UN700-B | 43" | IPS | 16:9 | 3840 × 2160 |
| LG 49UH5J | 49" | IPS | 16:9 | 3840 × 2160 |
| Philips 49B2U5900CH | 49" | VA | 32:9 | 5120 × 1440 |
| LG 49WL95C-WE | 49" | IPS | 32:9 | 5120 × 1440 |
| LG 65UH5J-H | 65" | IPS | 16:9 | 3840 × 2160 |
| Eizo DuraVision FDF2121WT-A | 21" | IPS | 16:9 | 1920 × 1080 |

### Canvas Layout
- Two independent setup canvases (**Setup A** and **Setup B**) rendered side by side for direct comparison
- Maximum grid of **2 rows × 4 columns** per setup
- Drag monitors from the catalog into any cell; drag existing monitors to reposition them
- Physical dimensions (mm) annotated on rows and columns so real-world desk width/height is always visible
- Monitors display their selected resolution and a resolution tier badge (FHD / QHD / 4K / 5K / 8K / ultrawide variants)

### Monitor Configuration (popover)
Clicking a placed monitor opens a popover to:
- **Change resolution** — select from the monitor's supported resolution list
- **Rotate orientation** — toggle between landscape and portrait
- **Add / remove PiP zones** — split the screen into up to 4 picture-in-picture sub-areas
- **Assign a test image** to the monitor or individual PiP zones (see Test Images section)
- **Remove** the monitor from the layout

### Labels
- A palette of colour-coded label swatches is available in the sidebar
- Drag a label onto any monitor or PiP zone to mark what that screen is used for (e.g. "Cameras", "Flight data", "ATC comms")
- Labels are stored as part of the setup state

### Picture-in-Picture (PiP)
- Supported on monitors 27" and larger
- Add 1–4 PiP zones per monitor; zones are rendered as proportional sub-rectangles inside the screen area
- Each zone can independently receive a label and a test image overlay

---

## Save & Load

### Auto-save
Both setups are automatically saved to `localStorage` on every change. They are restored on next page load with no user action required.

### Setup Export / Import (JSON)
Each setup can be exported to and imported from a standalone JSON file:
- **Export Setup A / B** — downloads a `.json` file containing the full layout (monitors, resolutions, orientations, PiP zones, labels)
- **Import Setup A / B** — loads a previously exported file; replaces the current setup on that canvas
- Exported setup files do **not** embed test images (asset references are preserved by ID; re-import the test media library separately)

### Catalog Export / Import (JSON)
The monitor catalog can be backed up and shared:
- **Export Catalog** — downloads a JSON file containing all monitors (built-in and custom)
- **Import Catalog** — merges custom monitors from a file into the current catalog; built-in entries are never overwritten; duplicate IDs are skipped

---

## Test Images

The test image feature lets you verify that a KVM receiver's output resolution actually matches the monitor it is connected to. Drop a screenshot or test pattern onto a monitor to see exactly how it will fill (or not fill) that screen at the chosen resolution.

### Adding Test Images
1. Open the **Test Media** section in the sidebar (visible when the feature is enabled)
2. Click **Upload Image** and select a PNG, JPEG, or WebP file
3. The image is stored in `localStorage` with its intrinsic pixel dimensions recorded
4. A size warning is shown if the library approaches browser storage limits

### Dropping a Test Image onto a Monitor
- Drag any image card from the Test Media library and drop it onto a monitor cell on the canvas
- The image can also be dropped onto an individual **PiP zone**
- Dropping onto an empty (unoccupied) cell is blocked with a toast message

### Resolution Scaling Visualisation
The overlay is rendered to reflect how the test image's pixel dimensions compare with the monitor's **currently selected resolution**. Once a test image is assigned, the **Test Image Scaling** control in the monitor popover lets you choose how the image is displayed:

| Mode | Label | Behaviour |
|---|---|---|
| `1:1` | Center | No scaling. The image is placed at its true pixel coverage relative to the selected resolution. Bars appear when the image is smaller; content is clipped when larger. Equivalent to GPU "No scaling / Center" mode. |
| `Aspect` | Aspect | Scale uniformly to fit the screen, preserving aspect ratio. Letterbox or pillarbox bars fill the remainder. Equivalent to GPU "Preserve aspect ratio" mode. |
| `Full` | Full | Stretch to fill the entire screen area regardless of aspect ratio. Equivalent to GPU "Full-screen" / "Full panel" mode. |

**Example**: A 1920 × 1200 test image on a monitor set to 3840 × 2160 (4K) in **1:1** mode is rendered at 50 % screen width and ≈ 55.6 % screen height, with dark bars on all four sides — immediately showing that the KVM stream does not fill the 4K panel. Switching to **Aspect** scales the image up to fit the height while adding pillarbox bars; **Full** stretches it to cover the panel completely.

Portrait orientation is handled automatically: the monitor's width and height values are swapped before computing the scale factors.

To clear a test image, open the monitor popover and click **Clear monitor media** or **Clear zone media**.

### Test Media Library Export / Import
- **Export Library** — downloads a JSON file containing all uploaded images (including base-64 encoded data)
- **Import Library** — merges images from a previously exported file; existing IDs are not duplicated

---

## Keyboard & Interaction Notes
- All drag-and-drop operations use the standard HTML5 drag API; no mouse gestures required
- Clicking outside an open popover closes it
- The canvas redraws automatically on every state change

---

## Architecture

| File | Role |
|---|---|
| `index.html` | Single-page shell, sidebar, popovers, script load order |
| `js/catalog.js` | Monitor data; custom monitor persistence |
| `js/state.js` | Central mutable state; all grid mutations; export / import helpers |
| `js/grid.js` | Physical-to-SVG coordinate maths |
| `js/canvas.js` | SVG rendering (monitors, labels, PiP zones, test image overlays, dimension annotations) |
| `js/drag.js` | HTML5 drag-and-drop wiring for catalog, labels, and test media |
| `js/labels.js` | Label swatch palette |
| `js/pip.js` | PiP zone rendering and interaction |
| `js/testmedia.js` | Test image library: upload, storage, export / import |
| `js/ui.js` | DOM binding, popovers, sidebar sections, info strip |
| `js/app.js` | Initialisation sequencing and feature flags |
| `css/` | Modular stylesheets per concern |

No framework, no build step, no backend.


