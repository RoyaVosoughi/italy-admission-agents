import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // native / WASM model runtime must stay outside the bundle
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],
};

export default nextConfig;
