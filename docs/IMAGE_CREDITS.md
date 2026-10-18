# Image Credits

Bundled images used by the mobile app. Pexels photos are used under the [Pexels License](https://www.pexels.com/license/) (free to use, attribution appreciated).

| File | Credit | Source |
|---|---|---|
| `backend/media/products/demo-prod-season-pass.jpg` | Photo by Jose David Cortes on Pexels | https://www.pexels.com/photo/drone-shot-of-football-stadium-15480801/ |
| `backend/media/products/demo-prod-programme.jpg` | Photo by Evi on Pexels | https://www.pexels.com/photo/top-view-shot-of-an-open-magazine-10058574/ |
| `backend/media/products/demo-prod-united-travel-shirt.jpg` | Photo by Fahmi Garna on Pexels | https://www.pexels.com/photo/gray-button-up-shirt-hanging-near-white-wall-13381986/ |
| `backend/media/products/demo-prod-training-hoodie.jpg` | Photo by Lappen Fashion on Pexels | https://www.pexels.com/photo/man-wearing-gray-sweater-and-blue-denim-jeans-4295985/ |
| `backend/media/products/demo-prod-supporter-cap.jpg` | Photo by Flo Luetzel on Pexels | https://www.pexels.com/photo/portrait-of-man-standing-by-the-shore-20842755/ |
| `mobile/assets/product-placeholder.jpg` | Photo by Filiz Yıldız on Pexels | https://www.pexels.com/photo/piles-of-folded-jeans-20143795/ |
| `backend/media/products/prod-jersey-001.jpg`, `demo-prod-rovers-jersey.jpg`, `demo-prod-united-scarf.jpg`, `demo-prod-training-bottle.jpg` | Demo product artwork added by the team on Day 1 | Project asset |
| `mobile/assets/stadium.jpg`, `mobile/assets/merch.jpg` | Demo artwork added by the team on Day 1 | Project asset |

Product images are served by the API from `backend/media/` (each product stores its image key); the app falls back to `mobile/assets/product-placeholder.jpg`.

## Icons and logo

- UI icons: [Phosphor Icons](https://phosphoricons.com) via `phosphor-react-native` (MIT licence).
- App logo ("Blade Crest"): original vector designed for this project (`mobile/src/components/AppMark.tsx`); raster icons in `mobile/assets/` are rendered from it.
