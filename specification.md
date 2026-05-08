
# Summary
A web-based tool to plan screen layouts and selection of sizes and resolutions for computer monitors to be placed on screen mounting rails on a desk.

The tool shall be used to make at least two alternatives on a static 2D surface that supports drag and drop for moving the screens around. Compare with split screen side by side. Also an experimental 3D preview of the finished desk would be nice.

# Requirements
- 2D screen layout planner with drag and drop
- At least 2 different 2D setups to be compared side by side
- A menu system to select different sizes of monitors and drag them onto the canvas of one of the two comparisons.
- The monitor selection must be with size and max resolutions given. For small monitors up to 32" use Dell series monitors as reference. For bigger monitors like 43" and 65" use known brands such as LG for reference.
- A maximum limit of 2 rows x 4 columns of screens
- Show calculated total height of row of screens
- Show calculated total width of all columns of screens
- Allow option for Picture in Picture on the screens from 27" and upwards
- Default screen sizes to select from: 21", 24", 27", 32", 43", 49", 65"
- Allow user to drag in squares with labels to be put onto each screen and/or picture in picture to indicate what the screen is used for
- Indicate monitor sizes and selected resolutions on the screen.
- Define an optional video stream composition input that the setups can be tested with. For now experimental feature.

# Frontend
HTML and CSS, vanilla javascript if required

# Backend
Python. Consider Fast-API. If there are problems with lack of functionality, pure javascript can be used.

