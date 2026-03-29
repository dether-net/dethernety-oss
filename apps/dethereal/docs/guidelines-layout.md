<!-- Loaded by editing skills (create, add, threat-model). Not loaded for read-only operations. -->

# Dethernety Threat Model Guidelines — Layout & Coordinates

## Coordinate System

- All position coordinates (`positionX`, `positionY`) are **relative to the parent boundary**
- Origin (0,0) is at the **top-left** of the parent boundary
- Components have a fixed visual size of **150×150 pixels**
- Position boundaries to avoid overlapping child elements
- Leave padding around boundaries for visual clarity (minimum 50px)

## Data Flow Handle Selection

Choose `sourceHandle` and `targetHandle` based on the **relative positions** of components:

| Target Position | Source Handle | Target Handle |
|-----------------|---------------|---------------|
| To the right    | right         | left          |
| Below           | bottom        | top           |
| To the left     | left          | right         |
| Above           | top           | bottom        |

**Important for STORE components:** They only have `left` and `right` handles — ignore the table above for STORE connections. Always use `left`/`right` regardless of relative position. Use horizontal connections only.

## Avoiding Handle Conflicts

Do NOT create flows between the same two components using the same handle pair. When bidirectional communication exists, use **different handle pairs** for each direction.

**BAD** (overlapping lines):
- Flow 1: A[right] → B[left]
- Flow 2: B[left] → A[right]

**GOOD** (clear separation):
- Flow 1: A[right] → B[left]
- Flow 2: B[bottom] → A[top]

## Boundary Sizing

- Size boundaries to contain all child elements with padding
- Minimum padding: 50px on each side
- Set `dimensionsMinWidth` and `dimensionsMinHeight` to prevent collapse
- Nested boundaries should fit within their parent with clearance

## Flow Direction Conventions

- Primary flow direction: **left-to-right** or **top-to-bottom** for readability
- External entities typically on the left or top
- Data stores typically on the right or bottom
- Group flows logically — request/response pairs should use consistent handle patterns
