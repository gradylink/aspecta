<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
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

const naturalWidth = ref(0);
const naturalHeight = ref(0);

const stageRef = ref<HTMLDivElement | null>(null);
const imageRef = ref<HTMLImageElement | null>(null);

const currentTask = computed(() => props.tasks[currentIndex.value] || null);

const hasMoreRatiosForImage = computed(() => {
  const next = props.tasks[currentIndex.value + 1];
  return !!currentTask.value && !!next &&
    next.fileName === currentTask.value.fileName;
});

const clamp = (val: number, min: number, max: number) =>
  Math.min(Math.max(val, min), max);

const cropAxis = computed<"x" | "y" | "none">(() => {
  if (!currentTask.value || !naturalWidth.value || !naturalHeight.value) {
    return "none";
  }
  const imageAspect = naturalWidth.value / naturalHeight.value;
  const targetAspect = currentTask.value.wRatio / currentTask.value.hRatio;
  if (Math.abs(imageAspect - targetAspect) < 0.001) return "none";
  return imageAspect > targetAspect ? "x" : "y";
});

const cropWidthFrac = computed(() => {
  if (!currentTask.value || !naturalWidth.value || !naturalHeight.value) {
    return 1;
  }
  if (cropAxis.value !== "x") return 1;
  const imageAspect = naturalWidth.value / naturalHeight.value;
  const targetAspect = currentTask.value.wRatio / currentTask.value.hRatio;
  return targetAspect / imageAspect;
});

const cropHeightFrac = computed(() => {
  if (!currentTask.value || !naturalWidth.value || !naturalHeight.value) {
    return 1;
  }
  if (cropAxis.value !== "y") return 1;
  const imageAspect = naturalWidth.value / naturalHeight.value;
  const targetAspect = currentTask.value.wRatio / currentTask.value.hRatio;
  return imageAspect / targetAspect;
});

const cropRectStyle = computed(() => {
  const wPct = cropWidthFrac.value * 100;
  const hPct = cropHeightFrac.value * 100;
  const leftPct = (100 - wPct) * (panX.value / 100);
  const topPct = (100 - hPct) * (panY.value / 100);

  return {
    left: `${leftPct}%`,
    top: `${topPct}%`,
    width: `${wPct}%`,
    height: `${hPct}%`,
  };
});

const updateNaturalSize = () => {
  const img = imageRef.value;
  if (img && img.complete && img.naturalWidth) {
    naturalWidth.value = img.naturalWidth;
    naturalHeight.value = img.naturalHeight;
  }
};

const handleImageLoad = () => {
  updateNaturalSize();
};

const NUDGE_STEP = 4;

const nudge = (dx: number, dy: number) => {
  if (cropAxis.value === "x" && dx !== 0) {
    panX.value = clamp(panX.value + dx * NUDGE_STEP, 0, 100);
  } else if (cropAxis.value === "y" && dy !== 0) {
    panY.value = clamp(panY.value + dy * NUDGE_STEP, 0, 100);
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  switch (event.key) {
    case "ArrowLeft":
      event.preventDefault();
      nudge(-1, 0);
      break;
    case "ArrowRight":
      event.preventDefault();
      nudge(1, 0);
      break;
    case "ArrowUp":
      event.preventDefault();
      nudge(0, -1);
      break;
    case "ArrowDown":
      event.preventDefault();
      nudge(0, 1);
      break;
    case "Enter":
    case " ":
      event.preventDefault();
      saveCurrentAndNext();
      break;
    case "Escape":
      event.preventDefault();
      handleCancel();
      break;
    case "s":
    case "S":
      if (hasMoreRatiosForImage.value) {
        event.preventDefault();
        skipRemainingInImage();
      }
      break;
    case "r":
    case "R":
      if (
        props.tasks.length > 1 && currentIndex.value < props.tasks.length - 1
      ) {
        event.preventDefault();
        skipRemaining();
      }
      break;
  }
};

const onPointerDown = (event: PointerEvent) => {
  if (cropAxis.value === "none" || !stageRef.value) return;

  isDragging.value = true;
  startMouseX.value = event.clientX;
  startMouseY.value = event.clientY;
  startPanX.value = panX.value;
  startPanY.value = panY.value;

  (event.target as HTMLElement).setPointerCapture(event.pointerId);
};

const onPointerMove = (event: PointerEvent) => {
  if (!isDragging.value || !stageRef.value) return;

  const stageRect = stageRef.value.getBoundingClientRect();
  if (!stageRect.width || !stageRect.height) return;

  if (cropAxis.value === "x") {
    const deltaX = event.clientX - startMouseX.value;
    const deltaLeftPct = (deltaX / stageRect.width) * 100;
    const range = 100 - cropWidthFrac.value * 100;
    const deltaPan = range > 0 ? (deltaLeftPct / range) * 100 : 0;
    panX.value = clamp(startPanX.value + deltaPan, 0, 100);
  } else if (cropAxis.value === "y") {
    const deltaY = event.clientY - startMouseY.value;
    const deltaTopPct = (deltaY / stageRect.height) * 100;
    const range = 100 - cropHeightFrac.value * 100;
    const deltaPan = range > 0 ? (deltaTopPct / range) * 100 : 0;
    panY.value = clamp(startPanY.value + deltaPan, 0, 100);
  }
};

const onPointerUp = (event: PointerEvent) => {
  if (!isDragging.value) return;
  isDragging.value = false;
  (event.target as HTMLElement).releasePointerCapture(event.pointerId);
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
  naturalWidth.value = 0;
  naturalHeight.value = 0;
};

watch(() => props.isOpen, (newVal) => {
  if (newVal) {
    reset();
    window.addEventListener("keydown", handleKeydown);
  } else {
    window.removeEventListener("keydown", handleKeydown);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});

watch(currentTask, async () => {
  panX.value = 50;
  panY.value = 50;
  await nextTick();
  updateNaturalSize();
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
          {{ cropAxis === 'none' ? 'Perfect fit, no cropping needed.' : 'Drag the frame to reposition the crop.' }}
          <span class="shortcut-hint">&nbsp;&middot; &larr;&uarr;&rarr;&darr; nudge &middot; Enter next &middot; Esc cancel</span>
        </p>

        <div class="framing-container-wrapper">
          <div ref="stageRef" class="frame-stage">
            <img
              ref="imageRef"
              :src="currentTask.previewUrl"
              class="frame-image"
              draggable="false"
              @load="handleImageLoad"
            />
            <div
              class="crop-rect"
              :class="{ 'cursor-grab': cropAxis !== 'none', 'cursor-grabbing': isDragging }"
              :style="cropRectStyle"
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
  max-width: min(92vw, 1100px);
  max-height: 92vh;
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

.shortcut-hint {
  opacity: 0.6;
  font-size: 0.82rem;
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

.frame-stage {
  position: relative;
  display: inline-block;
  line-height: 0;
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--radius);
  overflow: hidden;
}

.frame-image {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  height: 50vh;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}
.crop-rect {
  position: absolute;
  box-shadow: 0 0 0 2000px rgba(0, 0, 0, 0.6);
  border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 2px;
  touch-action: none;
  background:
    linear-gradient(rgba(255, 255, 255, 0.35) 1px, transparent 1px) 0 33.33% /
    100% 33.33%,
    linear-gradient(rgba(255, 255, 255, 0.35) 1px, transparent 1px) 0 66.66% /
    100% 33.33%,
    linear-gradient(90deg, rgba(255, 255, 255, 0.35) 1px, transparent 1px)
    33.33% 0 /
    33.33% 100%,
    linear-gradient(90deg, rgba(255, 255, 255, 0.35) 1px, transparent 1px)
    66.66% 0 /
    33.33% 100%;
  background-repeat: no-repeat;
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
