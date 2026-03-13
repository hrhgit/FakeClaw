const state = {
  bootstrap: null,
  analyzeResult: null,
  selectedOptionId: "",
  draftConfig: {
    composerSearch: {},
    clickFallback: {}
  }
};

const els = {
  configPath: document.querySelector("#config-path"),
  targetCount: document.querySelector("#target-count"),
  targetApp: document.querySelector("#target-app"),
  topCount: document.querySelector("#top-count"),
  openIfMissing: document.querySelector("#open-if-missing"),
  analyzeBtn: document.querySelector("#analyze-btn"),
  loadSavedBtn: document.querySelector("#load-saved-btn"),
  statusLine: document.querySelector("#status-line"),
  summaryContent: document.querySelector("#summary-content"),
  candidateCount: document.querySelector("#candidate-count"),
  candidateList: document.querySelector("#candidate-list"),
  draftBadge: document.querySelector("#draft-badge"),
  resultBadge: document.querySelector("#result-badge"),
  resultLabel: document.querySelector("#result-label"),
  composerJson: document.querySelector("#composer-json"),
  clickFallbackJson: document.querySelector("#click-fallback-json"),
  testMode: document.querySelector("#test-mode"),
  testPrompt: document.querySelector("#test-prompt"),
  testBtn: document.querySelector("#test-btn"),
  saveBtn: document.querySelector("#save-btn"),
  resultOutput: document.querySelector("#result-output")
};

function prettyJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function getSelectedTarget() {
  return els.targetApp.value;
}

function setBusy(isBusy, message) {
  els.analyzeBtn.disabled = isBusy;
  els.testBtn.disabled = isBusy;
  els.saveBtn.disabled = isBusy;
  els.loadSavedBtn.disabled = isBusy;
  if (message) {
    els.statusLine.textContent = message;
  }
}

function setResult(value) {
  els.resultOutput.textContent =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function setResultState(kind, text) {
  const normalized = kind || "neutral";
  els.resultBadge.className = `pill ${normalized === "neutral" ? "muted" : normalized}`;
  els.resultLabel.className = `result-label ${normalized}`;
  els.resultBadge.textContent = text;
  els.resultLabel.textContent = text;
}

function getTargetBootstrap(targetApp) {
  return state.bootstrap?.targets?.find((target) => target.id === targetApp) || null;
}

function loadDraft(calibrationConfig, label = "已载入") {
  state.draftConfig = {
    composerSearch: clone(calibrationConfig?.composerSearch || {}),
    clickFallback: clone(calibrationConfig?.clickFallback || {})
  };
  els.composerJson.value = prettyJson(state.draftConfig.composerSearch);
  els.clickFallbackJson.value = prettyJson(state.draftConfig.clickFallback);
  els.draftBadge.textContent = label;
}

function parseDraftConfig() {
  try {
    return {
      composerSearch: JSON.parse(els.composerJson.value || "{}"),
      clickFallback: JSON.parse(els.clickFallbackJson.value || "{}")
    };
  } catch (error) {
    throw new Error(`JSON 解析失败: ${error.message}`);
  }
}

function getTestPayload() {
  return {
    mode: els.testMode.value || "paste",
    prompt: els.testPrompt.value || ""
  };
}

function syncTestModeUi() {
  const { mode } = getTestPayload();
  const needsPrompt = mode === "paste";
  els.testPrompt.disabled = !needsPrompt;
  els.testPrompt.placeholder = needsPrompt
    ? "paste 模式会把这段文本粘贴进输入框"
    : "focus 模式不会使用提示词";
}

function buildCandidateOptions(result) {
  const options = [];

  for (const [index, candidate] of (result?.topCandidates || []).entries()) {
    options.push({
      id: `candidate-${index + 1}`,
      title: `${candidate.TypeName.replace("ControlType.", "")} / score ${candidate.Score}`,
      subtitle: candidate.ClassName || candidate.Name || candidate.AutomationId || "anonymous",
      detail: [
        `bounds: ${candidate.Bounds.Left}, ${candidate.Bounds.Top}, ${candidate.Bounds.Width} x ${candidate.Bounds.Height}`,
        `ratios: left ${candidate.Ratios.Left}, top ${candidate.Ratios.Top}, width ${candidate.Ratios.Width}, height ${candidate.Ratios.Height}`
      ].join("\n"),
      calibrationConfig: {
        composerSearch: clone(candidate.SuggestedComposerSearch || {}),
        clickFallback: clone(result.fallbackClick || {})
      }
    });
  }

  if (options.length === 0 && result?.fallbackClick) {
    options.push({
      id: "fallback-only",
      title: "Coordinate fallback",
      subtitle: "未找到可靠输入框候选，使用坐标兜底",
      detail: prettyJson(result.fallbackClick),
      calibrationConfig: {
        composerSearch: {},
        clickFallback: clone(result.fallbackClick)
      }
    });
  }

  return options;
}

function renderSummary() {
  const result = state.analyzeResult;

  if (!result) {
    els.summaryContent.innerHTML = `<p class="empty">还没有分析结果。</p>`;
    return;
  }

  const blocks = [
    ["窗口标题", result.windowTitle || "-"],
    ["目标应用", result.targetDisplayName || result.targetApp || "-"],
    ["候选数量", String((result.topCandidates || []).length)],
    ["模式", result.fallbackOnly ? "fallback" : "candidate"]
  ];

  els.summaryContent.innerHTML = blocks
    .map(
      ([label, value]) =>
        `<article><span class="meta-label">${label}</span><strong>${value}</strong></article>`
    )
    .join("");
}

function renderCandidates() {
  const options = buildCandidateOptions(state.analyzeResult);
  els.candidateCount.textContent = String(options.length);

  if (options.length === 0) {
    els.candidateList.innerHTML = `<p class="empty">当前没有可试跑的候选。</p>`;
    return;
  }

  els.candidateList.innerHTML = options
    .map((option) => {
      const activeClass = option.id === state.selectedOptionId ? " active" : "";
      return `
        <article class="candidate-card${activeClass}" data-option-id="${option.id}">
          <header>
            <h3>${option.title}</h3>
            <span class="pill">${option.id}</span>
          </header>
          <p class="candidate-meta">${option.subtitle.replace(/\n/g, "<br />")}</p>
          <p class="candidate-meta">${option.detail.replace(/\n/g, "<br />")}</p>
          <div class="candidate-actions">
            <button class="ghost" data-action="use" data-option-id="${option.id}">载入草稿</button>
          </div>
        </article>
      `;
    })
    .join("");

  els.candidateList.querySelectorAll("[data-action='use']").forEach((button) => {
    button.addEventListener("click", () => {
      const option = options.find((item) => item.id === button.dataset.optionId);
      if (!option) {
        return;
      }
      state.selectedOptionId = option.id;
      loadDraft(option.calibrationConfig, `已选择 ${option.id}`);
      renderCandidates();
    });
  });
}

function renderBootstrap() {
  if (!state.bootstrap) {
    return;
  }

  els.configPath.textContent = state.bootstrap.configPath;
  els.targetCount.textContent = String(state.bootstrap.targets.length);

  if (!els.targetApp.options.length) {
    els.targetApp.innerHTML = state.bootstrap.targets
      .map((target) => `<option value="${target.id}">${target.displayName}</option>`)
      .join("");
  }

  const current = getTargetBootstrap(getSelectedTarget()) || state.bootstrap.targets[0];
  if (current) {
    els.targetApp.value = current.id;
    loadDraft(current.calibrationConfig, "当前保存配置");
  }
}

async function requestJson(url, payload) {
  const response = await fetch(url, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.failureReason || `request_failed: ${response.status}`);
  }

  return data;
}

async function refreshBootstrap() {
  state.bootstrap = await requestJson("/api/calibration/bootstrap");
  renderBootstrap();
}

async function handleAnalyze() {
  setBusy(true, "正在分析当前窗口...");

  try {
    state.analyzeResult = await requestJson("/api/calibration/analyze", {
      targetApp: getSelectedTarget(),
      topCount: Number(els.topCount.value) || 8,
      openIfMissing: els.openIfMissing.checked
    });

    const options = buildCandidateOptions(state.analyzeResult);
    state.selectedOptionId = options[0]?.id || "";
    if (options[0]) {
      loadDraft(options[0].calibrationConfig, `已选择 ${options[0].id}`);
    }

    renderSummary();
    renderCandidates();
    setResult(state.analyzeResult);
    setResultState("success", "Analyze 成功");
    els.statusLine.textContent = "Analyze 完成。";
  } catch (error) {
    setResult({ status: "failed", failureReason: error.message });
    setResultState("failed", "Analyze 失败");
    els.statusLine.textContent = `Analyze 失败: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

async function handleTest() {
  const testPayload = getTestPayload();
  setBusy(true, `正在试跑 ${testPayload.mode}...`);

  try {
    const draft = parseDraftConfig();
    const payload = await requestJson("/api/calibration/test", {
      targetApp: getSelectedTarget(),
      calibrationConfig: draft,
      mode: testPayload.mode,
      prompt: testPayload.prompt
    });
    setResult(payload);
    setResultState("success", `${(payload.mode || testPayload.mode).toUpperCase()} 成功`);
    els.statusLine.textContent =
      payload.automation?.status === "success"
        ? `试跑成功，${payload.mode || testPayload.mode} 已完成。`
        : `试跑失败: ${payload.automation?.failureReason || `${testPayload.mode}_failed`}`;
  } catch (error) {
    setResult({ status: "failed", failureReason: error.message });
    setResultState("failed", `${testPayload.mode.toUpperCase()} 失败`);
    els.statusLine.textContent = `试跑失败: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

async function handleSave() {
  setBusy(true, "正在保存配置...");

  try {
    const draft = parseDraftConfig();
    const payload = await requestJson("/api/calibration/save", {
      targetApp: getSelectedTarget(),
      calibrationConfig: draft
    });
    await refreshBootstrap();
    setResult(payload);
    setResultState("success", "保存成功");
    els.statusLine.textContent = "配置已保存。";
  } catch (error) {
    setResult({ status: "failed", failureReason: error.message });
    setResultState("failed", "保存失败");
    els.statusLine.textContent = `保存失败: ${error.message}`;
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  els.analyzeBtn.addEventListener("click", handleAnalyze);
  els.testBtn.addEventListener("click", handleTest);
  els.saveBtn.addEventListener("click", handleSave);
  els.loadSavedBtn.addEventListener("click", () => {
    const current = getTargetBootstrap(getSelectedTarget());
    if (current) {
      loadDraft(current.calibrationConfig, "当前保存配置");
      setResult(current.calibrationConfig);
      setResultState("neutral", "已载入保存配置");
      els.statusLine.textContent = "已载入当前保存配置。";
    }
  });
  els.testMode.addEventListener("change", syncTestModeUi);
  els.targetApp.addEventListener("change", () => {
    const current = getTargetBootstrap(getSelectedTarget());
    if (current) {
      loadDraft(current.calibrationConfig, "当前保存配置");
    }
    state.analyzeResult = null;
    state.selectedOptionId = "";
    renderSummary();
    renderCandidates();
    setResult("已切换目标应用。");
    setResultState("neutral", "未运行");
  });
}

async function main() {
  bindEvents();
  await refreshBootstrap();
  syncTestModeUi();
  renderSummary();
  renderCandidates();
  setResult("页面已就绪。先运行 Analyze。");
  setResultState("neutral", "未运行");
}

main().catch((error) => {
  els.statusLine.textContent = `初始化失败: ${error.message}`;
  setResult({ status: "failed", failureReason: error.message });
  setResultState("failed", "初始化失败");
});
