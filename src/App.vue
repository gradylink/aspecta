<script setup lang="ts">
import { computed, ref } from "vue";
import {
  RiAddLine,
  RiCheckDoubleLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiFolderDownloadLine,
  RiImageLine,
  RiSettings3Line,
  RiUploadCloud2Line,
} from "@remixicon/vue";

interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
  status: "pending" | "processing" | "done" | "error";
}

interface AspectRatioSpec {
  id: string;
  label: string;
  wRatio: number;
  hRatio: number;
  custom?: boolean;
}

interface FormatSpec {
  id: string;
  label: string;
  extension: string;
  folder: string;
}

const DEFAULT_RATIOS: AspectRatioSpec[] = [
  { id: "1-1", label: "1-1", wRatio: 1, hRatio: 1 },
  { id: "3-4", label: "3-4", wRatio: 3, hRatio: 4 },
  { id: "4-3", label: "4-3", wRatio: 4, hRatio: 3 },
  { id: "2-3", label: "2-3", wRatio: 2, hRatio: 3 },
  { id: "3-2", label: "3-2", wRatio: 3, hRatio: 2 },
  { id: "16-9", label: "16-9", wRatio: 16, hRatio: 9 },
  { id: "9-16", label: "9-16", wRatio: 9, hRatio: 16 },
  { id: "21-9", label: "21-9", wRatio: 21, hRatio: 9 },
];

const AVAILABLE_FORMATS: FormatSpec[] = [
  { id: "jpg", label: "JPEG (.jpg)", extension: ".jpg", folder: "JPG" },
  { id: "png", label: "PNG (.png)", extension: ".png", folder: "PNG" },
  { id: "tiff", label: "TIFF (.tiff)", extension: ".tiff", folder: "TIFF" },
  { id: "webp", label: "WebP (.webp)", extension: ".webp", folder: "WEBP" },
];

const availableRatios = ref<AspectRatioSpec[]>([...DEFAULT_RATIOS]);
const selectedRatioIds = ref<string[]>(["1-1", "3-4", "4-3", "2-3", "3-2"]);
const selectedFormatIds = ref<string[]>(["jpg", "png", "tiff"]);

const customWidth = ref<number | null>(null);
const customHeight = ref<number | null>(null);

const queue = ref<QueueItem[]>([]);
const isProcessing = ref(false);
const totalProgress = ref(0);
const downloadUrl = ref<string | null>(null);

const startTime = ref<number | null>(null);
const etaSeconds = ref<number | null>(null);

const hasFiles = computed(() => queue.value.length > 0);

const selectedRatios = computed(() =>
  availableRatios.value.filter((r) => selectedRatioIds.value.includes(r.id))
);

const selectedFormats = computed(() =>
  AVAILABLE_FORMATS.filter((f) => selectedFormatIds.value.includes(f.id))
);

const totalOutputsPerImage = computed(() =>
  selectedRatios.value.length * selectedFormats.value.length
);

const totalOutputFiles = computed(() =>
  queue.value.length * totalOutputsPerImage.value
);

const formattedEta = computed(() => {
  if (etaSeconds.value === null || etaSeconds.value <= 0) return null;
  const mins = Math.floor(etaSeconds.value / 60);
  const secs = Math.ceil(etaSeconds.value % 60);
  if (mins > 0) {
    return `${mins}m ${secs}s remaining`;
  }
  return `${secs}s remaining`;
});

const addCustomRatio = () => {
  if (!customWidth.value || !customHeight.value) return;
  if (customWidth.value <= 0 || customHeight.value <= 0) return;

  const w = Math.round(customWidth.value);
  const h = Math.round(customHeight.value);
  const id = `${w}-${h}`;
  const label = `${w}-${h}`;

  if (!availableRatios.value.some((r) => r.id === id)) {
    availableRatios.value.push({
      id,
      label,
      wRatio: w,
      hRatio: h,
      custom: true,
    });
  }

  if (!selectedRatioIds.value.includes(id)) {
    selectedRatioIds.value.push(id);
  }

  customWidth.value = null;
  customHeight.value = null;
};

const toggleRatio = (id: string) => {
  if (selectedRatioIds.value.includes(id)) {
    selectedRatioIds.value = selectedRatioIds.value.filter((rId) => rId !== id);
  } else {
    selectedRatioIds.value.push(id);
  }
};

const toggleFormat = (id: string) => {
  if (selectedFormatIds.value.includes(id)) {
    selectedFormatIds.value = selectedFormatIds.value.filter((fId) =>
      fId !== id
    );
  } else {
    selectedFormatIds.value.push(id);
  }
};

const addFiles = (fileList: FileList | File[]) => {
  const newItems: QueueItem[] = Array.from(fileList)
    .filter((file) => file.type.startsWith("image/"))
    .map((file) => ({
      id: `${file.name}-${Date.now()}-${Math.random()}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "pending",
    }));

  queue.value = [...queue.value, ...newItems];
  downloadUrl.value = null;
};

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files) addFiles(target.files);
};

const handleDrop = (event: DragEvent) => {
  event.preventDefault();
  if (event.dataTransfer?.files) addFiles(event.dataTransfer.files);
};

const removeItem = (id: string) => {
  const item = queue.value.find((i) => i.id === id);
  if (item) URL.revokeObjectURL(item.previewUrl);
  queue.value = queue.value.filter((i) => i.id !== id);
};

const clearQueue = () => {
  queue.value.forEach((i) => URL.revokeObjectURL(i.previewUrl));
  queue.value = [];
  downloadUrl.value = null;
  totalProgress.value = 0;
  etaSeconds.value = null;
};

const startProcessing = async () => {
  if (
    queue.value.length === 0 ||
    isProcessing.value ||
    !selectedRatios.value.length ||
    !selectedFormats.value.length
  ) {
    return;
  }

  isProcessing.value = true;
  totalProgress.value = 0;
  startTime.value = Date.now();
  etaSeconds.value = null;

  const filePayloads = await Promise.all(
    queue.value.map(async (item) => ({
      name: item.file.name,
      buffer: await item.file.arrayBuffer(),
    })),
  );

  const options = {
    ratios: selectedRatios.value.map(({ label, wRatio, hRatio }) => ({
      label,
      wRatio,
      hRatio,
    })),
    formats: selectedFormats.value.map(({ id, extension, folder }) => ({
      id,
      extension,
      folder,
    })),
  };

  const worker = new Worker(
    new URL("./workers/processor.worker.ts", import.meta.url),
    { type: "module" },
  );

  worker.onmessage = (e) => {
    const { type, progress, blob, error } = e.data;

    if (type === "PROGRESS") {
      totalProgress.value = progress;

      if (startTime.value && progress > 0) {
        const elapsed = (Date.now() - startTime.value) / 1000;
        const totalEstimated = (elapsed / progress) * 100;
        etaSeconds.value = Math.max(0, totalEstimated - elapsed);
      }
    } else if (type === "DONE") {
      downloadUrl.value = URL.createObjectURL(blob);
      isProcessing.value = false;
      etaSeconds.value = null;
      worker.terminate();
    } else if (type === "ERROR") {
      console.error("Worker error:", error);
      isProcessing.value = false;
      etaSeconds.value = null;
      worker.terminate();
    }
  };

  worker.onerror = (err) => {
    console.error("Worker execution failed:", err);
    isProcessing.value = false;
    etaSeconds.value = null;
    worker.terminate();
  };

  const transferables = filePayloads.map((f) => f.buffer);
  worker.postMessage({ files: filePayloads, options }, transferables);
};
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <h1>Aspecta</h1>
      <p>Auto-crop into custom aspect ratios across multiple image formats</p>
    </header>

    <div
      class="drop-zone"
      @dragover.prevent
      @drop="handleDrop"
    >
      <input
        type="file"
        multiple
        accept="image/*"
        id="fileInput"
        @change="handleFileSelect"
      />
      <label for="fileInput">
        <div class="drop-zone-content">
          <RiUploadCloud2Line class="upload-icon" size="36px" />
          <span>Drop images here, or <span class="browse-link">browse</span></span>
          <span
            class="subtext">Supports single image or multi-file batches</span>
        </div>
      </label>
    </div>

    <section class="options-section">
      <div class="options-header">
        <RiSettings3Line size="18px" />
        <h3>Output Options</h3>
      </div>

      <div class="options-group">
        <label class="group-label">Aspect Ratios</label>
        <div class="chip-grid">
          <button
            v-for="ratio in availableRatios"
            :key="ratio.id"
            type="button"
            class="chip"
            :class="{ active: selectedRatioIds.includes(ratio.id) }"
            :disabled="isProcessing"
            @click="toggleRatio(ratio.id)"
          >
            {{ ratio.label }}
          </button>
        </div>

        <div class="custom-ratio-form">
          <input
            v-model.number="customWidth"
            type="number"
            placeholder="W"
            min="1"
            :disabled="isProcessing"
            @keyup.enter="addCustomRatio"
          />
          <span class="ratio-separator">:</span>
          <input
            v-model.number="customHeight"
            type="number"
            placeholder="H"
            min="1"
            :disabled="isProcessing"
            @keyup.enter="addCustomRatio"
          />
          <button
            type="button"
            class="btn-secondary"
            :disabled="isProcessing || !customWidth || !customHeight"
            @click="addCustomRatio"
          >
            <RiAddLine size="16px" />
            <span>Add Ratio</span>
          </button>
        </div>
      </div>

      <div class="options-group">
        <label class="group-label">Output Formats</label>
        <div class="chip-grid">
          <button
            v-for="fmt in AVAILABLE_FORMATS"
            :key="fmt.id"
            type="button"
            class="chip"
            :class="{ active: selectedFormatIds.includes(fmt.id) }"
            :disabled="isProcessing"
            @click="toggleFormat(fmt.id)"
          >
            {{ fmt.label }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="hasFiles" class="queue-section">
      <div class="queue-header">
        <h3>Queue ({{ queue.length }})</h3>
        <button class="btn-text" @click="clearQueue" :disabled="isProcessing">
          <RiDeleteBinLine size="16px" />
          <span>Clear all</span>
        </button>
      </div>

      <ul class="file-grid">
        <li v-for="item in queue" :key="item.id" class="file-card">
          <img :src="item.previewUrl" :alt="item.file.name" class="thumb" />
          <div class="file-info">
            <span class="file-name">{{ item.file.name }}</span>
            <span
              class="file-size">{{ (item.file.size / 1024 / 1024).toFixed(2) }} MB</span>
          </div>
          <button
            class="btn-remove"
            @click="removeItem(item.id)"
            :disabled="isProcessing"
            aria-label="Remove image"
          >
            <RiCloseLine size="18px" />
          </button>
        </li>
      </ul>
    </section>

    <div v-if="hasFiles" class="specs-summary">
      <RiImageLine size="18px" class="icon-accent" />
      <span>
        {{ queue.length }} {{ queue.length === 1 ? "image" : "images" }} &times; {{ selectedRatios.length }} ratios &times; {{ selectedFormats.length }} formats =
        <strong>{{ totalOutputFiles }} files total</strong>
      </span>
    </div>

    <div v-if="hasFiles" class="action-buttons">
      <button
        v-if="!isProcessing && !downloadUrl"
        class="btn primary"
        :disabled="!selectedRatios.length || !selectedFormats.length"
        @click="startProcessing"
      >
        <RiCheckDoubleLine size="20px" />
        <span>Process {{ queue.length }} {{ queue.length === 1 ? "Image" : "Images" }}</span>
      </button>

      <div v-if="isProcessing" class="progress-wrapper">
        <div class="progress-container">
          <div class="progress-bar"
            :style="{ width: totalProgress + '%' }"></div>
          <span>{{ totalProgress }}%</span>
        </div>
        <p class="status-text">
          Cropping and converting images...
          <span v-if="formattedEta">({{ formattedEta }})</span>
        </p>
      </div>

      <a
        v-if="downloadUrl"
        :href="downloadUrl"
        download="processed_images.zip"
        class="btn download"
      >
        <RiFolderDownloadLine size="20px" />
        <span>Download ZIP Archive</span>
      </a>
    </div>
  </div>
</template>
