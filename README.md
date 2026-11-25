# The Last Light

An immersive WebGL fragrance house set in an abandoned lighthouse. Vite, vanilla JS, Three.js, GSAP, custom GLSL.

    npm install
    npm run dev
    npm run build

Force a quality tier with `?q=high`, `?q=low` or `?q=mobile`. Without it the tier is picked from the device and GPU, and resolution adapts to frame time.

## Moving

| Place | Do |
| --- | --- |
| Open sea, approach, underwater, stair | Hold (or W / Space), mouse looks |
| Around the tower, lantern room | Drag, wheel to move closer |
| Below | Drag up at the waterline, or hold at "The waterline" |
| Rock and hall | Hold or WASD to walk, mouse looks |
| Lever | Drag it, or click |
| Bottle | Drag to turn, wheel or pinch to zoom |

## Where things are

- `src/camera/` modes (`cameraStates`), choreography and physical layers (`cameraController`), the graph of real openings flights pass through (`routes`)
- `src/world/` ocean, rock, lighthouse, interior, lantern, weather, sky, procedural materials
- `src/product/` fragrance data, SDF-traced glass bottle, product system
- `src/postProcessing.js` HDR frame graph: volumetric fog and beam, underwater medium, bloom, grade
- `src/interactions.js` places, bottles, the lever and the lighting sequence
- `src/shop/cart.js` local cart; checkout is a labelled demonstration, no payments
- `src/audioManager.js` all sound is synthesised
- `dev/` journey and frame-time harnesses (not shipped)

Everything visual and audible is generated in code; there are no third-party models, textures or recordings. Fonts: Castoro, Castoro Titling, Hanken Grotesk (OFL).
