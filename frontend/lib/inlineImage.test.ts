import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function arrayBuffer() {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
});

import { imageResponseToDataUrl } from "./inlineImage";

describe("inline catalog image", () => {
  it("turns an image response into a data url and skips other bodies", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const dataUrl = await imageResponseToDataUrl(
      new Response(png, { status: 200, headers: { "Content-Type": "image/png" } }),
    );
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(
      await imageResponseToDataUrl(
        new Response("no", { status: 200, headers: { "Content-Type": "text/html" } }),
      ),
    ).toBeNull();
  });
});
