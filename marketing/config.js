// Set this to the actual public repository and published release assets.
// Null downloads stay unavailable; the website never invents a binary URL.
window.CLOSED_CODE_SITE = {
  repository: "ahpah-dev/closedcode",
  version: "",
  unsigned: true,
  // Change only after a successful smoke test on a real Mac. Per-architecture
  // objects (arm64/x64) are also supported for these verification fields.
  macNativeVerified: false,
  macBuildMethod: "pending",
  macVerificationNote: "Native Mac smoke testing is pending.",
  downloads: {
    windows: null,
    mac: { arm64: null, x64: null },
  },
  checksumUrl: "",
};
