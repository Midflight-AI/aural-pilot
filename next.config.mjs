/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/session/video/*": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/linux/x64/ffprobe"],
    "/api/internal/video/process": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/linux/x64/ffprobe"],
  },
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: [
    "pdf-parse",
    "ws",
    "bufferutil",
    "utf-8-validate",
  ],
};

export default nextConfig;
