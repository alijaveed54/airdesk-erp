"use client";

import { useState } from "react";

export default function TestUploadPage() {
  const [image, setImage] = useState<File | null>(null);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  async function upload() {
    if (!image) {
      setResult("Please choose image first.");
      return;
    }

    setLoading(true);
    setResult("");

    const formData = new FormData();
    formData.append("file", image);

    const res = await fetch("/api/upload/image", {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    setResult(JSON.stringify(data, null, 2));
    setLoading(false);
  }

  return (
    <div style={{ padding: 40 }}>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setImage(e.target.files?.[0] ?? null)}
      />

      <button
        onClick={upload}
        disabled={loading}
        style={{
          marginLeft: 20,
          padding: "10px 20px",
          background: "blue",
          color: "white",
          borderRadius: 8,
        }}
      >
        {loading ? "Uploading..." : "Upload"}
      </button>

      <pre style={{ marginTop: 30, whiteSpace: "pre-wrap" }}>{result}</pre>
    </div>
  );
}