const state = {
  mode: "image",
  files: [],
};

const input = document.querySelector("#media-input");
const list = document.querySelector("#demo-list");
const count = document.querySelector("#file-count");
const output = document.querySelector("#output-format");
const qualityWrap = document.querySelector("#quality-wrap");
const convertButton = document.querySelector("#convert-button");
const message = document.querySelector("#demo-message");

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});
input.addEventListener("change", () => {
  const chosen = Array.from(input.files || []).slice(0, 3);
  state.files = chosen;
  if ((input.files || []).length > 3) setMessage("网页版体验最多处理 3 个文件，已保留前 3 个。", true);
  else setMessage("");
  render();
});
convertButton.addEventListener("click", convertFiles);

function setMode(mode) {
  state.mode = mode;
  state.files = [];
  input.value = "";
  input.accept = mode === "image" ? "image/*" : "audio/*";
  qualityWrap.hidden = mode !== "image";
  output.innerHTML = mode === "image"
    ? '<option value="jpg">JPG</option><option value="png">PNG</option>'
    : '<option value="wav">WAV（浏览器原生）</option><option value="mp3" disabled>MP3（请使用 Android App）</option>';
  document.querySelectorAll(".segment").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  setMessage("");
  render();
}

function render() {
  count.textContent = state.files.length ? `已选择 ${state.files.length} / 3 个文件` : "最多选择 3 个文件";
  convertButton.disabled = state.files.length === 0;
  list.replaceChildren();
  if (!state.files.length) {
    const empty = document.createElement("div");
    empty.className = "demo-empty";
    empty.innerHTML = "<strong>还没有选择文件</strong><span>网页体验每次最多处理 3 个文件。</span>";
    list.append(empty);
    return;
  }
  state.files.forEach((file, index) => {
    const row = document.createElement("div");
    row.className = "demo-row";
    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = extension(file.name);
    row.append(icon);
    if (state.mode === "image") {
      const thumb = document.createElement("img");
      thumb.src = URL.createObjectURL(file);
      thumb.alt = "";
      thumb.style.cssText = "width:42px;height:38px;object-fit:cover;border-radius:7px";
      row.append(thumb);
    } else {
      const player = document.createElement("audio");
      player.controls = true;
      player.src = URL.createObjectURL(file);
      player.preload = "metadata";
      row.append(player);
    }
    const name = document.createElement("span");
    name.className = "row-name";
    name.title = file.name;
    name.textContent = file.name;
    row.append(name);
    const remove = document.createElement("button");
    remove.className = "row-action";
    remove.type = "button";
    remove.textContent = "移除";
    remove.addEventListener("click", () => {
      state.files.splice(index, 1);
      render();
    });
    row.append(remove);
    list.append(row);
  });
}

async function convertFiles() {
  if (!state.files.length) return;
  convertButton.disabled = true;
  setMessage("正在本地处理…");
  try {
    if (state.mode === "image") await Promise.all(state.files.map(convertImage));
    else {
      if (output.value !== "wav") throw new Error("MP3 编码请使用 Android App");
      for (const file of state.files) await convertAudioToWav(file);
    }
    setMessage("处理完成，文件已下载到浏览器的下载目录。", false);
  } catch (error) {
    setMessage(error.message || "处理失败，请换一个文件再试。", true);
  } finally {
    convertButton.disabled = false;
  }
}

async function convertImage(file) {
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d").drawImage(image, 0, 0);
  const format = output.value;
  const quality = Math.max(1, Math.min(100, Number(document.querySelector("#quality").value) || 100)) / 100;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, format === "jpg" ? "image/jpeg" : "image/png", quality));
  if (!blob) throw new Error(`无法转换 ${file.name}`);
  download(blob, `${baseName(file.name)}.${format}`);
}

async function convertAudioToWav(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("当前浏览器不支持音频解码");
  const context = new AudioContextClass();
  try {
    const source = await context.decodeAudioData(await file.arrayBuffer());
    download(new Blob([encodeWav(source)], { type: "audio/wav" }), `${baseName(file.name)}.wav`);
  } finally {
    await context.close();
  }
}

function encodeWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const output = new ArrayBuffer(44 + frames * channels * bytesPerSample);
  const view = new DataView(output);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + frames * channels * bytesPerSample, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, frames * channels * bytesPerSample, true);
  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return output;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(image.src); resolve(image); };
    image.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    image.src = URL.createObjectURL(file);
  });
}

function download(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function extension(name) { return (name.split(".").pop() || "FILE").slice(0, 5).toUpperCase(); }
function baseName(name) { return name.replace(/\.[^/.]+$/, "") || "converted"; }
function setMessage(text, isError = false) { message.textContent = text; message.style.color = isError ? "#9b1529" : "#176d6e"; }

render();
