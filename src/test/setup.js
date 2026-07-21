// Vitest setup — runs before each test file.
// Adds jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...).
import '@testing-library/jest-dom/vitest';

// jsdom ships no ResizeObserver. Components that observe their own box (the
// overlay preview's scaler) would otherwise throw on mount, which reads as a
// component bug rather than a missing browser API. A no-op is enough: jsdom
// gives everything a 0×0 box, so an observation would never fire anyway.
if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
}
