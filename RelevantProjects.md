This file is a curated list of relevant, *existing* visualization systems to copy patterns from when implementing HyperView.

## Instructions: research these repos with DeepWiki first

Before implementing a feature inspired by any project below, use DeepWiki to quickly locate the real implementation points (rendering pipeline, selection model, state management, linked views, etc.).

Suggested workflow:

1. Use DeepWiki to list the repository docs/structure (to learn the module boundaries).
2. Ask targeted questions that map to *our* features (e.g. lasso selection, brushing, cross-filtering, point rendering, view linking).
3. For any promising file/module names returned by DeepWiki, open those files locally in your editor and study the concrete code patterns.

DeepWiki tool usage in this environment:

- `mcp_cognitionai_d_read_wiki_structure(repoName="owner/repo")`
- `mcp_cognitionai_d_ask_question(repoName="owner/repo", question="…")`

Example questions that tend to pay off:

- “Where is lasso selection implemented, and how does it map screen-space polygon → selected point IDs?”
- “How is linked selection state propagated across views (scatter ↔ table ↔ metadata histograms)?”
- “What’s the rendering backend (WebGL/WebGPU/Canvas) and how are millions of points batched?”
- “How is search/nearest-neighbor handled in the UI and data layer?”

## Shortlist (GitHub + why it’s relevant)

- **Nomic Atlas (Data Maps / selections + lasso)** — GitHub: https://github.com/nomic-ai/nomic (Python SDK), https://github.com/nomic-ai/ts-nomic (TypeScript SDK) — Relevant because it’s a production embedding/data-map UI with selection workflows (lasso/tag/filter/share) at multi‑million point scale.
	- Demo: https://atlas.nomic.ai/map/twitter
	- Docs (controls, incl. lasso): https://docs.nomic.ai/api/datasets/data-maps/controls#lasso

- **Nomic Atlas “Data Stories” examples** — GitHub: https://github.com/nomic-ai/atlas-stories-examples — Relevant because it shows how to embed/map-state-share interactive atlas views into narrative scroll experiences (useful for “shareable views” / reproducible camera states).

- **Nomic Atlas cookbook** — GitHub: https://github.com/nomic-ai/cookbook — Relevant because it contains practical end-to-end examples for building maps/pipelines that can inform how we structure loaders, metadata, and export formats.

- **FiftyOne (Voxel51)** — GitHub: https://github.com/voxel51/fiftyone — Relevant because it’s the closest open-source reference for an embedding visualizer tightly linked to a dataset browser (select points ↔ inspect samples/labels ↔ filter slices).
	- Demo / quickstart notebook: https://colab.research.google.com/github/voxel51/fiftyone-examples/blob/master/examples/quickstart.ipynb

- **Rerun** — GitHub: https://github.com/rerun-io/rerun — Relevant because it’s a high-performance interactive viewer for large multimodal data (2D/3D/time) with strong UX patterns for inspection, streaming, and view synchronization.
	- Browser demo: https://rerun.io/viewer

- **Apple Embedding Atlas** — GitHub: https://github.com/apple/embedding-atlas — Relevant because it demonstrates a modern WebGPU-first rendering pipeline (WebGL fallback) for millions of points plus linked views/search and density-oriented navigation.
	- Demo + docs: https://apple.github.io/embedding-atlas/

---

## Notes / deep dive

### Apple Embedding Atlas

**Repository**: https://github.com/apple/embedding-atlas
**License**: MIT (2025)
**Scale**: Handles 2-5 million points smoothly

### 1. Visualization Architecture

**Monorepo Structure** with clear separation of concerns:
- `packages/component`: Core `EmbeddingView` and `EmbeddingViewMosaic` visualization components
- `packages/table`: Data table component for metadata display
- `packages/viewer`: Main application and embeddable `EmbeddingAtlas` component
- `packages/density-clustering`: Rust-based clustering algorithm
- `packages/umap-wasm`: WebAssembly UMAP implementation (C++ umappp library)
- `packages/embedding-atlas`: Unified npm package exposing all APIs
- `packages/backend`: Python CLI tool and Jupyter widget support

**Framework Flexibility**: Supports React, Svelte, and vanilla JavaScript components.

**Browser-First Architecture**: All computations run entirely in the browser (embedding generation, projection, clustering) for data privacy and reproducibility.

### 2. Large Point Cloud Rendering

**Dual Rendering Pipeline**:
- **Primary**: WebGPU implementation for modern browsers (Chrome 113+, Edge 113+, Safari 16.4+ with flags)
- **Fallback**: WebGL 2.0 for backward compatibility
- **Performance**: 10-100x faster than pure JavaScript implementations

**Scale Performance**:
- Handles 2-5 million points with sub-second updates
- Achieves 60 FPS on mid-range GPUs for 2M-point datasets
- Performance scales linearly with GPU capabilities

**Data Optimization**:
- Compressed binary formats for efficient data transfer
- Memory-optimized data structures

**Advanced Rendering Technique**:
- **Order-Independent Transparency (OIT)**: Custom fragment shaders resolve overlapping points without sorting operations, eliminating visual artifacts in high-density areas while maintaining individual point visibility
- Customizable color encoding and point size adjustments

### 3. Interaction Model

**Multi-View Coordination**:
- Real-time search and nearest neighbors for finding similar embeddings
- Cross-filtering: Multi-coordinated views enable linked filtering across metadata columns
- Smooth pan/zoom interactions with sub-second response times

**Density Exploration**:
- Kernel density estimation (KDE) with density contours to distinguish dense regions from outliers
- Automatic clustering with interactive labels for overall data structure understanding

**Visual Clarity**:
- Automatic data clustering reduces visual clutter
- Density-based contours help navigate complex point distributions

### 4. WebGL/Canvas Rendering Patterns

**Progressive Enhancement Approach**:
- Modern WebGPU graphics pipeline as primary renderer
- Graceful degradation to WebGL 2 maintains core functionality
- Custom shader implementations for transparency and compositing

**Key Techniques**:
- Order-independent transparency using advanced fragment shader techniques
- GPU batching for efficient point rendering
- Optimized compositing for overlapping geometry

### 5. Performance at Scale

**Computational Performance**:
- WebAssembly compilation (Rust + C++) enables near-native performance for algorithms
- Browser-native UMAP and clustering implementations avoid server round-trips

**Memory Management**:
- Compressed data formats reduce memory footprint
- Optimized data structures for large datasets

**Rendering Performance**:
- GPU-accelerated rendering pipeline
- Sampling and batching strategies for millions of points
- 60 FPS target maintained for interactive operations

**Browser Compatibility**:
- Full WebGPU support in modern browsers
- Automatic fallback to WebGL 2.0 ensures broad compatibility
- Maintains core functionality across rendering backends

### Key Takeaways for HyperView

1. **Dual rendering pipeline** (WebGPU + WebGL fallback) provides excellent performance and compatibility
2. **Order-independent transparency** is critical for high-density point clouds
3. **Browser-first architecture** with WebAssembly algorithms enables privacy and performance
4. **Multi-view coordination** and cross-filtering enhance exploratory workflows
5. **Density-based visualization** (KDE contours, clustering) helps users navigate large datasets
6. **Compressed binary formats** and memory optimization enable handling millions of points
7. **Modular package structure** allows embedding components in various frameworks

---

## Nomic Atlas

**Platform**: https://atlas.nomic.ai/
**Documentation**: https://docs.nomic.ai/
**Scale**: Supports hundreds to tens of millions of points across multiple modalities (text, images, audio, video)

### 1. Visualization Architecture

**Client-Server Model**: Python client library communicates with the Atlas platform backend. The frontend is built with Next.js and React, featuring:
- Server-side rendering and streaming capabilities
- Code splitting with lazy-loaded chunks
- Modular component architecture with parallel routing
- Progressive enhancement with error boundaries

**SDK Support**: Programmatic access through Python/TypeScript SDKs and REST API endpoints, enabling integration into data pipelines.

**Production-Scale Design**: Architected to handle massive datasets with smooth interactions, optimized for collaborative workflows.

### 2. Embedding Visualization Approach

**2D Projection Algorithms**:
- **UMAP**: Default for datasets with fewer than 50,000 points
- **Nomic Project**: Proprietary algorithm, default for datasets with 50,000+ points
- **Custom Coordinates**: Support for user-provided X/Y coordinates or geospatial positioning

**Semantic Relationships**: The 2D projections preserve semantic relationships from high-dimensional embeddings, enabling similarity-based exploration.

**Visual Customization**:
- Color-coding by categorical or numerical data columns
- Dynamic point sizing via interactive sliders
- Topic label overlays with automatic topic modeling
- Filtering by numerical metadata (sentiment, temperature, price, etc.)
- Timestamp-based slicing for temporal trend analysis

**Multi-Modal Support**: Designed to handle diverse data types (text, images, audio, video) within a single visualization paradigm.

### 3. Lasso Selection Implementation

**Freeform Selection**: Users drag a lasso around a region to select all points contained within the drawn area. This circular selection method is a core interaction pattern for exploratory data analysis.

**Composable Selections**: Lasso selections can be combined with other tools to create complex data queries:
- **Vector Search**: Find semantically similar points based on embeddings
- **Exact Search**: Locate points matching specific text or metadata
- **Filters**: Numerical or categorical filtering by data attributes
- **Cherry Pick**: Individual point selection

**Data Workflows**: The lasso tool integrates into broader data curation and analysis pipelines:
1. **Selection**: Use lasso, search, or filters to identify data subsets
2. **Tagging**: Apply tags to organize and mark selected subsets for tracking
3. **Data Cleaning**: Remove outliers or unwanted regions
4. **Analysis**: Export selections for further processing

**Use Cases**:
- Identifying and removing outlier regions in embedding space
- Marking clusters or subsets for further analysis
- Discovering patterns through interactive exploration
- Data curation and quality control

### 4. Data Map Rendering Patterns

**Search Modes** for exploring large datasets:
- **Query Search**: Answer analytical questions across the dataset
- **Document Search**: Find data similar to provided text samples
- **Embedding Search**: Match against user-provided vectors (requires dimensional consistency with dataset embeddings)

**Interactive Features**:
- Highlighting of exact-matching points on the map during search
- Real-time filtering and search result visualization
- Server-side propagation of user edits (visible to all users upon refresh for collaborative work)

**Performance Optimization**: Designed to handle millions of points with smooth interactions. Specific rendering techniques not publicly documented, but the platform demonstrates production-grade performance at scale.

### 5. Relevant Architecture Patterns

**Data Pipeline Integration**:
- Seamless integration with Python-based data workflows
- Support for notebook environments (Jupyter, etc.)
- API-first design enabling programmatic access

**Collaborative Features**:
- Server-side state management for selections and edits
- Multi-user support with shared map views
- Real-time updates propagated across users

**Scalability Strategy**:
- Algorithm selection based on dataset size (UMAP for <50k, Nomic Project for 50k+)
- Optimized for both interactive exploration and batch processing
- Supports progressive enhancement from small to massive datasets

### Key Takeaways for HyperView

1. **Scalability First**: Design for large datasets from the start (50k+ points) with automatic algorithm switching
2. **Composable Tools**: Allow lasso selection to combine with other filtering/search methods for complex queries
3. **Tagging System**: Implement a way to tag and organize selected subsets for data curation workflows
4. **Multiple Projection Options**: Support both standard (UMAP) and custom projection methods
5. **Progressive Loading**: Use code splitting and lazy loading for performance
6. **Server-Side State**: Consider propagating selections/edits server-side for collaborative workflows
7. **Multi-Modal First**: Design the architecture to handle diverse data types from the beginning
8. **Topic Modeling**: Automatic topic detection and labeling adds significant value to exploration

**References**:
- [Nomic Atlas Platform](https://atlas.nomic.ai/)
- [Twitter Map Example](https://atlas.nomic.ai/map/twitter)
- [Data Maps Controls Documentation](https://docs.nomic.ai/api/datasets/data-maps/controls)
- [Vector Search Guide](https://docs.nomic.ai/api/datasets/data-maps/guides/vector-search-over-your-data)
- [Embedding Visualization Guide](https://docs.nomic.ai/platform/embeddings-and-retrieval/guides/how-to-visualize-embeddings)
- [GitHub - nomic-ai/nomic](https://github.com/nomic-ai/nomic)
- [HuggingFace: Data Exploration with Nomic Atlas](https://huggingface.co/blog/visheratin/nomic-data-cleaning)

---

## FiftyOne (Voxel51)

**Repository**: https://github.com/voxel51/fiftyone
**Documentation**: https://docs.voxel51.com/

### Key Architecture Patterns

**Embedding Visualization Panel:**
- Built on FiftyOne's "Spaces" framework for organizing interactive panels
- Uses Plotly for JavaScript-based responsive interactive plots
- Bidirectional synchronization with main app via sample/label IDs

**Scatter Plot Rendering:**
- Primary backend: Plotly (default) - responsive JavaScript-based plots
- Alternative: Matplotlib for notebooks
- All plots support "zoom, pan, and lasso" interactions

**Interaction Modes:**
- Lasso Select (freeform)
- Box Select (rectangular)
- Zoom (in/out/autoscale)
- Pan (click-drag)
- Shift to add regions, double-click to deselect

**Data Pipeline:**
1. Embedding generation (default model, custom, or Model Zoo)
2. Dimensionality reduction (UMAP default, t-SNE, PCA)
3. Storage via `brain_key` identifier
4. Interactive scatterplot visualization

**Key Takeaways for HyperView:**
1. Use Plotly for proven scatter plot interactions
2. Bidirectional sync via ID-based references is critical
3. Session-based architecture mediates frontend-backend state
4. Brain key pattern enables multiple visualizations per dataset
5. Support multiple dimensionality reduction methods

**References:**
- [FiftyOne Plots Documentation](https://docs.voxel51.com/user_guide/plots.html)
- [Image Embeddings Tutorial](https://docs.voxel51.com/tutorials/image_embeddings.html)

---

## Hyperbolic Geometry References

For implementing correct Poincaré disk navigation:

### Mathematical Foundations

**Möbius Transformation (disk automorphism):**
```
T_a(z) = (z - a) / (1 - conj(a) * z)   where |a| < 1
```
Maps point 'a' to origin while preserving the disk.

**Möbius Addition (gyroaddition) from geoopt:**
```
x ⊕ y = ((1 + 2⟨x,y⟩ + ‖y‖²)x + (1 - ‖x‖²)y) / (1 + 2⟨x,y⟩ + ‖x‖²‖y‖²)
```
This is the correct formula for "adding" vectors in hyperbolic space.

**Hyperbolic Distance:**
```
d(z1, z2) = 2 * arctanh(|z1 - z2| / |1 - conj(z1) * z2|)
```

### Anchor-Invariant Pan Implementation

For drag semantics where the point under cursor stays under cursor:
1. Find data point `p` under start position: `p = T_a⁻¹(d1)`
2. Target display position: `d2`
3. Solve for new camera `a'` such that `T_{a'}(p) = d2`

This requires solving a linear system derived from the Möbius transform equation.

**References:**
- [Mathematics LibreTexts - Poincaré Disk Model](https://math.libretexts.org/Bookshelves/Geometry/Geometry_with_an_Introduction_to_Cosmic_Topology_(Hitchman)/05:_Hyperbolic_Geometry/5.01:_The_Poincare_Disk_Model)
- [geoopt - κ-Stereographic Projection](https://geoopt.readthedocs.io/en/latest/extended/stereographic.html)
- [Jason Davies - Poincaré Disc](https://www.jasondavies.com/poincare-disc/)
- [hyperbolic-canvas (GitHub)](https://github.com/ItsNickBarry/hyperbolic-canvas)