# Contributing to hyper-scatter

First off, thanks for taking the time to contribute!

This project has a unique architecture designed to ensure correctness while maximizing performance. Before you write code, please understand the **Reference/Candidate** methodology.

## The Core Philosophy

We maintain two implementations for every renderer:

1.  **Reference (Canvas2D)**: The "Ground Truth". Optimized for readability and correctness.
2.  **Candidate (WebGL2)**: The "Speed Demon". Optimized for performance.

Any feature or bug fix must first be verified in the **Reference** implementation. Once the semantics are correct there, we port/optimize it in the **Candidate** implementation and verify they match using the accuracy benchmarks.

## Development Workflow

1.  **Install dependencies**
    ```bash
    npm install
    ```

2.  **Run the dev server**
    ```bash
    npm run dev
    ```

3.  **Run benchmarks**
    *   **Correctness**: `npm run bench:accuracy` (Run this before opening a PR!)
    *   **Performance**: `npm run bench`

## Future Roadmap

We are looking for contributions in the following areas:
*   **Spherical Geometry**: Implementing spherical embeddings (S²) using the same Reference/Candidate pattern.
*   **WASM Core**: Moving the heavy math checks to WASM for even better CPU throughput.

## Code Style

*   We use TypeScript.
*   Formatting is handled by Prettier/ESLint (run lint before committing).

## Attribution

By contributing to this project, you agree that your contributions will be licensed under the MIT License.
