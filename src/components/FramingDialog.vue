<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  RiArrowRightLine,
  RiSkipForwardLine,
  RiSkipForwardMiniLine,
} from "@remixicon/vue";

export interface FrameTask {
  id: string;
  previewUrl: string;
  fileName: string;
  ratioLabel: string;
  wRatio: number;
  hRatio: number;
}

export interface FrameResult {
  taskId: string;
  panX: number;
  panY: number;
}

interface Props {
  isOpen: boolean;
  tasks: FrameTask[];
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "complete", results: FrameResult[]): void;
  (e: "cancel"): void;
}>();

const currentIndex = ref(0);
const results = ref<FrameResult[]>([]);

const panX = ref(50);
const panY = ref(50);
const isDragging = ref(false);
const startMouseX = ref(0);
const startMouseY = ref(0);
const startPanX = ref(50);
const startPanY = ref(50);

const slideAxis = ref<"x" | "y" | "none">("none");
const imageRef = ref<HTMLImageElement | null>(null);

const currentTask = computed(() => props.tasks[currentIndex.value] || null);

const hasMoreRatiosForImage = computed(() => {
  const next = props.tasks[currentIndex.value + 1];
  return !!currentTask.value && !!next &&
    next.fileName === currentTask.value.fileName;
});

const clamp = (val: number, min: number, max: number) =>
  Math.min(Math.max(val, min), max);

const handleImageLoad = (event: Event) => {
  const img = event.target as HTMLImageElement;
  if (!currentTask.value) return;

  const imageAspect = img.naturalWidth / img.naturalHeight;
  const containerAspect = currentTask.value.wRatio / currentTask.value.hRatio;

  if (Math.abs(imageAspect - containerAspect) < 0.01) {
    slideAxis.value = "none";
  } else if (imageAspect > containerAspect) {
    slideAxis.value = "x";
  } else {
    slideAxis.value = "y";
  }

  panX.value = 50;
  panY.value = 50;
};

const onPointerDown = (event: PointerEvent) => {
  if (slideAxis.value === "none" || !imageRef.value) return;

  isDragging.value = true;
  startMouseX.value = event.clientX;
  startMouseY.value = event.clientY;
  startPanX.value = panX.value;
  startPanY.value = panY.value;

  imageRef.value.setPointerCapture(event.pointerId);
};

const onPointerMove = (event: PointerEvent) => {
  if (!isDragging.value) return;

  const sensitivity = 0.2;

  if (slideAxis.value === "x") {
    const deltaX = event.clientX - startMouseX.value;
    panX.value = clamp(startPanX.value - deltaX * sensitivity, 0, 100);
  } else if (slideAxis.value === "y") {
    const deltaY = event.clientY - startMouseY.value;
    panY.value = clamp(startPanY.value - deltaY * sensitivity, 0, 100);
  }
};

const onPointerUp = (event: PointerEvent) => {
  if (!isDragging.value || !imageRef.value) return;
  isDragging.value = false;
  imageRef.value.releasePointerCapture(event.pointerId);
};

const saveCurrentAndNext = () => {
  if (!currentTask.value) return;

  results.value.push({
    taskId: currentTask.value.id,
    panX: panX.value,
    panY: panY.value,
  });

  if (currentIndex.value < props.tasks.length - 1) {
    currentIndex.value++;
    panX.value = 50;
    panY.value = 50;
  } else {
    emit("complete", results.value);
    reset();
  }
};

const skipRemainingInImage = () => {
  if (!currentTask.value) return;
  const fileName = currentTask.value.fileName;

  let idx = currentIndex.value;
  const skipped: FrameResult[] = [];
  while (idx < props.tasks.length && props.tasks[idx].fileName === fileName) {
    skipped.push({ taskId: props.tasks[idx].id, panX: 50, panY: 50 });
    idx++;
  }

  results.value.push(...skipped);

  if (idx < props.tasks.length) {
    currentIndex.value = idx;
    panX.value = 50;
    panY.value = 50;
  } else {
    emit("complete", results.value);
    reset();
  }
};

const skipRemaining = () => {
  const remaining = props.tasks.slice(currentIndex.value).map((task) => ({
    taskId: task.id,
    panX: 50,
    panY: 50,
  }));

  emit("complete", [...results.value, ...remaining]);
  reset();
};

const handleCancel = () => {
  emit("cancel");
  reset();
};

const reset = () => {
  currentIndex.value = 0;
  results.value = [];
  panX.value = 50;
  panY.value = 50;
};

watch(() => props.isOpen, (newVal) => {
  if (newVal) {
    reset();
  }
});
</script>

<template>
  <div v-if="isOpen" class="dialog-backdrop" @mousedown.self="handleCancel">
    <div class="dialog-content">
      <header class="dialog-header">
        <h3>Frame Image ({{ currentIndex + 1 }} / {{ tasks.length }})</h3>
        <span class="ratio-badge">Ratio: {{ currentTask?.ratioLabel }}</span>
      </header>

      <div class="dialog-body" v-if="currentTask">
        <p class="helper-text">
          {{ slideAxis === 'none' ? 'Perfect fit, no panning needed.' : 'Click and drag to slide the image into frame.' }}
        </p>

        <div class="framing-container-wrapper">
          <div
            class="framing-container"
            :style="{ aspectRatio: `${currentTask.wRatio} / ${currentTask.hRatio}` }"
          >
            <img
              ref="imageRef"
              :src="currentTask.previewUrl"
              :style="{ objectPosition: `${panX}% ${panY}%` }"
              class="framing-image"
              :class="{ 'cursor-grab': slideAxis !== 'none', 'cursor-grabbing': isDragging }"
              draggable="false"
              @load="handleImageLoad"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
            />
          </div>
        </div>
      </div>

      <footer class="dialog-footer">
        <button class="btn-text" @click="handleCancel">Cancel</button>
        <div class="action-group">
          <button
            v-if="hasMoreRatiosForImage"
            class="btn-secondary"
            @click="skipRemainingInImage"
          >
            <RiSkipForwardLine size="18px" />
            <span>Skip Remaining In Image</span>
          </button>
          <button
            v-if="tasks.length > 1 && currentIndex < tasks.length - 1"
            class="btn-secondary"
            @click="skipRemaining"
          >
            <RiSkipForwardMiniLine size="18px" />
            <span>Skip Remaining</span>
          </button>
          <button class="btn primary" @click="saveCurrentAndNext">
            <span>{{ currentIndex === tasks.length - 1 ? "Finish" : "Next" }}</span>
            <RiArrowRightLine size="18px" />
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.dialog-content {
  background: var(--bg-color);
  border-radius: var(--radius);
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.dialog-header h3 {
  margin: 0;
  font-size: 1.1rem;
}

.ratio-badge {
  background: var(--surface-color);
  padding: 4px 10px;
  height: 1.5rem;
  border-radius: 1.5rem;
  font-size: 0.85rem;
  font-weight: 600;
}

.dialog-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.helper-text {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
  flex-shrink: 0;
}

.framing-container-wrapper {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background: var(--bg-mantle);
  border-radius: 8px;
  padding: var(--radius);
}

.framing-container {
  position: relative;
  width: 100%;
  max-height: 100%;
  overflow: hidden;
  border: 2px dashed var(--border-color);
  border-radius: var(--radius);
}

.framing-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  touch-action: none;
}

.cursor-grab {
  cursor: grab;
}

.cursor-grabbing {
  cursor: grabbing;
}

.dialog-footer {
  padding: 16px 24px;
  border-top: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.action-group {
  display: flex;
  gap: 12px;
}
</style>
