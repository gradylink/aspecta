import JSZip from "jszip";
import {
  ImageMagick,
  type IMagickImage,
  initializeImageMagick,
  MagickFormat,
  MagickGeometry,
} from "@imagemagick/magick-wasm";
import magickWasmUrl from "@imagemagick/magick-wasm/magick.wasm?url";

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
  cropEnabled: boolean;
}

const MAGICK_FORMAT_MAP: Record<string, MagickFormat> = {
  jpg: MagickFormat.Jpeg,
  png: MagickFormat.Png,
  tiff: MagickFormat.Tiff,
  webp: MagickFormat.WebP,
  avif: MagickFormat.Avif,
  gif: MagickFormat.Gif,
  bmp: MagickFormat.Bmp,
  jxl: MagickFormat.Jxl,
  ico: MagickFormat.Ico,
};

let magickReady: Promise<void> | null = null;

const ensureMagickInitialized = async (): Promise<void> => {
  if (!magickReady) {
    magickReady = (async () => {
      const response = await fetch(magickWasmUrl);
      const wasmBytes = await response.arrayBuffer();
      await initializeImageMagick(wasmBytes);
    })();
  }
  return magickReady;
};

const writeImage = (image: IMagickImage, format: MagickFormat): Uint8Array => {
  let output: Uint8Array = new Uint8Array();
  image.write(format, (data) => {
    output = data.slice();
  });
  return output;
};

const isUnsupportedFormatError = (message: string): boolean =>
  /no decode delegate|unable to read|not a supported|unable to open/i.test(
    message,
  );

self.onmessage = async (
  e: MessageEvent<{
    files: { id: string; name: string; buffer: ArrayBuffer }[];
    options: ProcessOptions;
  }>,
) => {
  const { files, options } = e.data;
  const { ratios, formats, frames, cropEnabled } = options;

  if (!formats.length) {
    self.postMessage({
      type: "ERROR",
      error: "At least one output format must be selected.",
    });
    return;
  }

  if (cropEnabled && !ratios.length) {
    self.postMessage({
      type: "ERROR",
      error:
        "At least one aspect ratio must be selected when cropping is enabled.",
    });
    return;
  }

  try {
    await ensureMagickInitialized();

    const zip = new JSZip();
    const folderMap = new Map<string, JSZip>();
    for (const fmt of formats) {
      folderMap.set(fmt.id, zip.folder(fmt.folder)!);
    }

    let completedTasks = 0;
    let successfulFiles = 0;
    const tasksPerFile = cropEnabled ? ratios.length : 1;
    const totalTasks = files.length * tasksPerFile;

    for (const fileItem of files) {
      self.postMessage({ type: "FILE_START", fileId: fileItem.id });

      let ratiosCompletedForFile = 0;

      try {
        const baseName = fileItem.name.replace(/\.[^/.]+$/, "");
        const inputBytes = new Uint8Array(fileItem.buffer);

        ImageMagick.read(inputBytes, (image) => {
          if (cropEnabled) {
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

              const frame = frames.find(
                (f) => f.taskId === `${fileItem.id}-${ratio.id}`,
              );
              const panX = frame?.panX ?? 50;
              const panY = frame?.panY ?? 50;

              const left = Math.round(((imgWidth - cropW) * panX) / 100);
              const top = Math.round(((imgHeight - cropH) * panY) / 100);

              const fileNamePrefix = files.length > 1
                ? `${baseName}_${ratio.label}`
                : ratio.label;

              image.clone((clone) => {
                clone.crop(new MagickGeometry(left, top, cropW, cropH));
                clone.resetPage();

                for (const fmt of formats) {
                  const folder = folderMap.get(fmt.id);
                  if (!folder) continue;

                  const magickFormat = MAGICK_FORMAT_MAP[fmt.id];
                  if (!magickFormat) continue;

                  clone.quality = fmt.id === "jpg" ? 90 : 92;
                  const buf = writeImage(clone, magickFormat);
                  folder.file(`${fileNamePrefix}${fmt.extension}`, buf);
                }
              });

              completedTasks++;
              ratiosCompletedForFile++;

              self.postMessage({
                type: "PROGRESS",
                progress: Math.round((completedTasks / totalTasks) * 100),
              });
            }
          } else {
            for (const fmt of formats) {
              const folder = folderMap.get(fmt.id);
              if (!folder) continue;

              const magickFormat = MAGICK_FORMAT_MAP[fmt.id];
              if (!magickFormat) continue;

              image.quality = fmt.id === "jpg" ? 90 : 92;
              const buf = writeImage(image, magickFormat);
              folder.file(`${baseName}${fmt.extension}`, buf);
            }

            completedTasks++;
            ratiosCompletedForFile++;

            self.postMessage({
              type: "PROGRESS",
              progress: Math.round((completedTasks / totalTasks) * 100),
            });
          }
        });

        successfulFiles++;
        self.postMessage({ type: "FILE_DONE", fileId: fileItem.id });
      } catch (fileErr) {
        const remaining = tasksPerFile - ratiosCompletedForFile;
        completedTasks += remaining;

        let errorMessage = (fileErr as Error).message;
        if (isUnsupportedFormatError(errorMessage)) {
          errorMessage = "Unsupported file format.";
        }

        self.postMessage({
          type: "FILE_ERROR",
          fileId: fileItem.id,
          error: ["", errorMessage],
        });
        self.postMessage({
          type: "PROGRESS",
          progress: Math.round((completedTasks / totalTasks) * 100),
        });
      }
    }

    if (successfulFiles === 0) {
      self.postMessage({
        type: "ERROR",
        error: "All images failed to process.",
      });
      return;
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    self.postMessage({ type: "DONE", blob: zipBlob });
  } catch (err) {
    self.postMessage({ type: "ERROR", error: (err as Error).message });
  }
};
