import Vips from "wasm-vips";
import JSZip from "jszip";

interface AspectRatioSpec {
  id: string;
  label: string;
  wRatio: number;
  hRatio: number;
}

interface FormatSpec {
  id: string;
  extension: string;
  folder: string;
}

interface FrameResult {
  taskId: string;
  panX: number;
  panY: number;
}

interface ProcessOptions {
  ratios: AspectRatioSpec[];
  formats: FormatSpec[];
  frames: FrameResult[];
}

let vipsInstance: typeof Vips | null = null;

const getVips = async (): Promise<typeof Vips> => {
  if (!vipsInstance) {
    vipsInstance = await Vips({ dynamicLibraries: [] });
  }
  return vipsInstance;
};

self.onmessage = async (
  e: MessageEvent<{
    files: { id: string; name: string; buffer: ArrayBuffer }[];
    options: ProcessOptions;
  }>,
) => {
  const { files, options } = e.data;
  const { ratios, formats, frames } = options;

  if (!ratios.length || !formats.length) {
    self.postMessage({
      type: "ERROR",
      error: "At least one aspect ratio and format must be selected.",
    });
    return;
  }

  try {
    const vips = await getVips();
    const zip = new JSZip();

    const folderMap = new Map<string, JSZip>();
    for (const fmt of formats) {
      folderMap.set(fmt.id, zip.folder(fmt.folder)!);
    }

    let completedTasks = 0;
    const totalTasks = files.length * ratios.length;

    for (const fileItem of files) {
      const baseName = fileItem.name.replace(/\.[^/.]+$/, "");
      const inputBytes = new Uint8Array(fileItem.buffer);

      const image = vips.Image.newFromBuffer(inputBytes);
      const imgWidth = image.width;
      const imgHeight = image.height;

      for (const ratio of ratios) {
        const targetAspect = ratio.wRatio / ratio.hRatio;
        const currentAspect = imgWidth / imgHeight;

        let cropW: number;
        let cropH: number;

        if (currentAspect > targetAspect) {
          cropH = imgHeight;
          cropW = Math.round(imgHeight * targetAspect);
        } else {
          cropW = imgWidth;
          cropH = Math.round(imgWidth / targetAspect);
        }

        const frame = frames.find((f) =>
          f.taskId === `${fileItem.id}-${ratio.id}`
        );
        const panX = frame?.panX ?? 50;
        const panY = frame?.panY ?? 50;

        const left = Math.round(((imgWidth - cropW) * panX) / 100);
        const top = Math.round(((imgHeight - cropH) * panY) / 100);

        const cropped = image.crop(left, top, cropW, cropH);
        const fileNamePrefix = files.length > 1
          ? `${baseName}_${ratio.label}`
          : ratio.label;

        for (const fmt of formats) {
          const folder = folderMap.get(fmt.id);
          if (!folder) continue;

          let buf: Uint8Array;
          if (fmt.id === "jpg") {
            buf = cropped.writeToBuffer(fmt.extension, { Q: 90 });
          } else {
            buf = cropped.writeToBuffer(fmt.extension);
          }

          folder.file(`${fileNamePrefix}${fmt.extension}`, buf);
        }

        cropped.delete();

        completedTasks++;
        self.postMessage({
          type: "PROGRESS",
          progress: Math.round((completedTasks / totalTasks) * 100),
        });
      }

      image.delete();
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    self.postMessage({ type: "DONE", blob: zipBlob });
  } catch (err) {
    self.postMessage({ type: "ERROR", error: (err as Error).message });
  }
};
