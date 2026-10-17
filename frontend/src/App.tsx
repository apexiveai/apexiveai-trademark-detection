import {
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeftRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileImage,
  FileText,
  Fingerprint,
  Gauge,
  Image as ImageIcon,
  LoaderCircle,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";

const API_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8017";

type UploadSide = "a" | "b";
type UploadSlot = UploadSide;

type FileInfo = {
  name: string;
  size_bytes: number;
  extracted_image_count?: number;
};

type ApplicationNumberResult = {
  status: string;
  reference_numbers?: string[];
  comparison_numbers?: string[];
};

type EvidenceRegion = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
  confidence?: number;
};

type ComparisonResult = {
  overall_similarity: number;
  text_similarity: number;
  visual_similarity: number;
  visual_status?: string;
  risk_level: string;
  assessment_status?: string;
  application_number?: ApplicationNumberResult;
  visual_match?: {
    reference_image_index?: number;
    comparison_image_index?: number;
    similarity?: number;
  } | null;
  visual_evidence?: {
    regions?: EvidenceRegion[];
    max_regions?: number;
    status?: string;
  };
  limitations?: string[];
};

type ApiResponse = {
  result: ComparisonResult;
  files?: FileInfo[];
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function safeScore(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function getRiskClass(level: string): string {
  const value = level.toLowerCase();
  if (value === "high") return "risk-high";
  if (value === "medium") return "risk-medium";
  return "risk-low";
}

function getFileIcon(file: File): typeof FileText {
  if (file.type.startsWith("image/")) return FileImage;
  if (file.name.toLowerCase().endsWith(".xlsx")) return FileImage;
  return FileText;
}

function ScoreRing({
  score,
  label,
  accent = "cyan",
}: {
  score: number;
  label: string;
  accent?: "cyan" | "violet";
}) {
  const value = safeScore(score);

  return (
    <div
      className={`score-ring score-ring-${accent}`}
      style={{ "--score": `${value * 3.6}deg` } as CSSProperties}
      aria-label={`${label}: ${value.toFixed(1)} percent`}
    >
      <div className="score-ring-inner">
        <strong>{value.toFixed(1)}<small>%</small></strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function UploadCard({
  slot,
  file,
  onFile,
  onRemove,
}: {
  slot: UploadSlot;
  file: File | null;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = (selected?: File) => {
    if (selected) onFile(selected);
  };

  const handleDrop = (
    side: UploadSide,
    event: DragEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    setDragging(false);
    handleFile(event.dataTransfer.files?.[0]);
    if (!file) return;
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const FileIcon = file ? getFileIcon(file) : UploadCloud;

  return (
    <div
      className={`upload-card ${dragging ? "is-dragging" : ""} ${
        file ? "has-file" : ""
      }`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => handleDrop("a", event)}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        accept=".pdf,.xlsx,.xlsm,.txt,.png,.jpg,.jpeg,.webp,.svg"
        onChange={handleChange}
      />

      <div className="upload-card-top">
        <span className={`file-index file-index-${slot}`}>
          {slot.toUpperCase()}
        </span>
        <span className="upload-tag">
          {file ? "FILE READY" : "SOURCE FILE"}
        </span>
        {file && (
          <button
            className="icon-button remove-file"
            onClick={onRemove}
            aria-label={`Remove file ${slot.toUpperCase()}`}
            type="button"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className={`upload-icon ${file ? "upload-icon-active" : ""}`}>
        <FileIcon size={27} strokeWidth={1.5} />
      </div>

      {file ? (
        <div className="file-details">
          <strong title={file.name}>{file.name}</strong>
          <span>{formatBytes(file.size)}</span>
          <span className="file-ready">
            <CheckCircle2 size={13} /> READY FOR ANALYSIS
          </span>
        </div>
      ) : (
        <div className="upload-copy">
          <h3>{slot === "a" ? "Reference Mark" : "Comparison Mark"}</h3>
          <p>
            {slot === "a"
              ? "Upload the original trademark file."
              : "Upload the mark you want to compare."}
          </p>
          <button
            className="browse-button"
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            <UploadCloud size={15} /> Browse files
          </button>
        </div>
      )}

      <div className="upload-card-bottom">
        <span>PDF · XLSX · SVG · PNG · JPG · TXT</span>
        <span>MAX 50 MB*</span>
      </div>
    </div>
  );
}

export default function App() {
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  const canCompare = Boolean(fileA && fileB && !loading);

  const checkApi = async () => {
    try {
      const response = await fetch(`${API_URL}/health`);
      setApiOnline(response.ok);
    } catch {
      setApiOnline(false);
    }
  };

  const compareFiles = async () => {
    if (!fileA || !fileB) {
      setError("Please upload both reference and comparison files.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file_a", fileA);
      formData.append("file_b", fileB);

      const response = await fetch(`${API_URL}/api/v1/compare`, {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        const detail =
          typeof payload.detail === "string"
            ? payload.detail
            : "The comparison request failed.";
        throw new Error(detail);
      }

      if (!payload?.result) {
        throw new Error("The API response did not contain a comparison result.");
      }

      setResult(payload as ApiResponse);
      setApiOnline(true);

      window.setTimeout(() => {
        document
          .getElementById("analysis-results")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message}. Check that the backend is running at ${API_URL}.`
          : `Unable to connect to ${API_URL}.`,
      );
      setApiOnline(false);
    } finally {
      setLoading(false);
    }
  };

  const currentResult = result?.result;
  const overall = safeScore(currentResult?.overall_similarity);
  const visual = safeScore(currentResult?.visual_similarity);
  const text = safeScore(currentResult?.text_similarity);
  const application = currentResult?.application_number;
  const evidence = currentResult?.visual_evidence;
  const regions = evidence?.regions ?? [];
  const files = result?.files ?? [];

  return (
    <main className="app-shell">
      <div className="city-background" aria-hidden="true" />
      <div className="city-vignette" aria-hidden="true" />
      <div className="ambient ambient-cyan" aria-hidden="true" />
      <div className="ambient ambient-violet" aria-hidden="true" />
      <div className="ambient-grid" aria-hidden="true" />
      <div className="ambient-scanline" aria-hidden="true" />

      <div className="app-content">
        <header className="topbar">
          <a className="brand" href="#" aria-label="Apexive AI home">
            <div className="brand-mark">
              <Fingerprint size={25} strokeWidth={1.8} />
              <span />
            </div>
            <div className="brand-copy">
              <strong>APEXIVE<span>AI</span></strong>
              <small>INTELLIGENCE SYSTEMS</small>
            </div>
          </a>

          <nav className="top-nav" aria-label="Main navigation">
            <a className="nav-link nav-link-active" href="#workspace">
              Workspace
            </a>
            <a className="nav-link" href="#analysis-results">
              Analysis
            </a>
            <a className="nav-link" href="#system-status">
              System
            </a>
          </nav>

          <div className="topbar-right">
            <div className="system-pill">
              <span className={`status-dot ${apiOnline === false ? "status-offline" : ""}`} />
              <span>{apiOnline === false ? "API OFFLINE" : "SYSTEM NODE"}</span>
            </div>
            <button
              className="icon-button refresh-button"
              onClick={checkApi}
              title="Check backend connection"
              type="button"
            >
              <Activity size={17} />
            </button>
          </div>
        </header>

        <section className="hero">
          <div className="hero-main">
            <div className="eyebrow">
              <span className="eyebrow-line" />
              TRADEMARK INTELLIGENCE / TOKYO NODE
              <span className="eyebrow-live"><span /> LIVE</span>
            </div>

            <h1>
              Brand protection,
              <br />
              <span>reimagined.</span>
            </h1>

            <p className="hero-description">
              Analyze trademark similarities with a unified workspace for
              visual marks, document content and application-number screening.
            </p>

            <a className="hero-cta" href="#workspace">
              <span>Open analysis workspace</span>
              <ArrowDown size={16} />
            </a>

            <div className="hero-proof">
              <div className="proof-icon"><ShieldCheck size={16} /></div>
              <span>PRELIMINARY SCREENING</span>
              <i />
              <span>DOCUMENT ANALYSIS</span>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="hero-orbit orbit-one" />
            <div className="hero-orbit orbit-two" />
            <div className="hero-orbit orbit-three" />
            <div className="hero-core">
              <div className="hero-core-inner">
                <Fingerprint size={61} strokeWidth={1} />
                <span>AI</span>
              </div>
            </div>
            <div className="orbit-label orbit-label-top">
              <span className="orbit-label-dot" />
              VISUAL ANALYSIS
            </div>
            <div className="orbit-label orbit-label-bottom">
              <span className="orbit-label-dot violet-dot" />
              BRAND INTELLIGENCE
            </div>
            <div className="hero-coordinates">35°39'12.0"N<br />139°42'18.0"E</div>
            <div className="hero-radar-line" />
          </div>

          <div className="hero-side-label">
            <span>東京</span>
            <i />
            <span>TOKYO / 01</span>
          </div>
        </section>

        <section className="metrics" aria-label="System overview">
          <div className="metric-card">
            <div className="metric-icon metric-cyan"><ScanSearch size={18} /></div>
            <div className="metric-content">
              <span>ANALYSIS ENGINE</span>
              <strong>DOCUMENT <em>+</em> IMAGE</strong>
              <small>PDF · XLSX · IMAGE</small>
            </div>
            <ArrowUpRight className="metric-arrow" size={16} />
          </div>

          <div className="metric-card">
            <div className="metric-icon metric-violet"><Cpu size={18} /></div>
            <div className="metric-content">
              <span>COMPUTATION</span>
              <strong>LOCAL API</strong>
              <small>PORT 8017 · FASTAPI</small>
            </div>
            <ArrowUpRight className="metric-arrow" size={16} />
          </div>

          <div className="metric-card">
            <div className="metric-icon metric-blue"><Gauge size={18} /></div>
            <div className="metric-content">
              <span>ASSESSMENT MODE</span>
              <strong>PRELIMINARY</strong>
              <small>SCREENING ONLY</small>
            </div>
            <ArrowUpRight className="metric-arrow" size={16} />
          </div>
        </section>

        <section className="workspace-section" id="workspace">
          <div className="section-heading">
            <div>
              <div className="section-kicker"><span>01</span> / INPUT STATION</div>
              <h2>Comparison <span>workspace</span></h2>
              <p>Choose two files to initiate trademark screening.</p>
            </div>
            <div className="section-status">
              <span className="status-ring"><span /></span>
              READY TO ANALYZE
            </div>
          </div>

          <div className="upload-grid">
            <UploadCard
              slot="a"
              file={fileA}
              onFile={(file) => {
                setFileA(file);
                setError("");
                setResult(null);
              }}
              onRemove={() => setFileA(null)}
            />

            <div className="compare-connector" aria-hidden="true">
              <div className="connector-line" />
              <div className="connector-core"><ArrowLeftRight size={18} /></div>
              <span>COMPARE</span>
              <div className="connector-line" />
            </div>

            <UploadCard
              slot="b"
              file={fileB}
              onFile={(file) => {
                setFileB(file);
                setError("");
                setResult(null);
              }}
              onRemove={() => setFileB(null)}
            />
          </div>

          <div className="workspace-actions">
            <div className="upload-guidance">
              <ShieldCheck size={16} />
              <span>Files are sent to your configured comparison API.</span>
            </div>
            <button
              className="compare-button"
              type="button"
              disabled={!canCompare}
              onClick={compareFiles}
            >
              {loading ? (
                <>
                  <LoaderCircle size={18} className="spin" />
                  ANALYZING FILES...
                </>
              ) : (
                <>
                  <Sparkles size={17} />
                  RUN COMPARISON
                  <ArrowLeftRight size={17} />
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="error-message" role="alert">
              <X size={17} />
              <span>{error}</span>
            </div>
          )}
        </section>

        {loading && (
          <section className="processing-panel" aria-live="polite">
            <div className="processing-visual">
              <div className="processing-ring" />
              <ScanSearch size={28} />
            </div>
            <div>
              <span className="section-kicker">ANALYSIS IN PROGRESS</span>
              <h3>Processing your documents</h3>
              <p>Extracting available text and image data from both files.</p>
            </div>
            <div className="processing-bars"><i /><i /><i /><i /><i /></div>
          </section>
        )}

        {currentResult && (
          <section className="results-section" id="analysis-results">
            <div className="section-heading">
              <div>
                <div className="section-kicker"><span>02</span> / ANALYSIS OUTPUT</div>
                <h2>Intelligence <span>report</span></h2>
                <p>Scores returned by the current backend comparison engine.</p>
              </div>
              <div className="result-badge">
                <CheckCircle2 size={15} />
                ANALYSIS RECEIVED
              </div>
            </div>

            <div className="results-overview">
              <div className="overall-card">
                <div className="result-card-heading">
                  <div>
                    <span className="card-overline">OVERALL SIMILARITY</span>
                    <h3>Comparison score</h3>
                  </div>
                  <div className="small-icon"><Fingerprint size={19} /></div>
                </div>

                <div className="overall-score-row">
                  <ScoreRing score={overall} label="OVERALL" />
                  <div className="overall-description">
                    <span className={`risk-badge ${getRiskClass(currentResult.risk_level)}`}>
                      <span />
                      {currentResult.risk_level || "UNASSESSED"} RISK
                    </span>
                    <h4>
                      {overall >= 80
                        ? "High similarity detected"
                        : overall >= 55
                          ? "Review recommended"
                          : "Lower similarity score"}
                    </h4>
                    <p>
                      This is a screening score, not a legal conclusion or a
                      probability of trademark infringement.
                    </p>
                  </div>
                </div>

                <div className="score-scale">
                  <span>LOW</span><i /><i /><i /><i /><span>HIGH</span>
                </div>
              </div>

              <div className="breakdown-card">
                <div className="result-card-heading">
                  <div>
                    <span className="card-overline">SIGNAL BREAKDOWN</span>
                    <h3>Similarity metrics</h3>
                  </div>
                  <div className="small-icon violet-small"><Activity size={18} /></div>
                </div>

                <div className="metric-bar-row">
                  <div className="metric-bar-label">
                    <span><ImageIcon size={15} /> Logo similarity</span>
                    <strong>{visual.toFixed(1)}%</strong>
                  </div>
                  <div className="metric-bar"><i style={{ width: `${visual}%` }} /></div>
                  <small>Logo-focused score from extracted image regions</small>
                </div>

                <div className="metric-bar-row">
                  <div className="metric-bar-label">
                    <span><FileText size={15} /> Text similarity</span>
                    <strong>{text.toFixed(1)}%</strong>
                  </div>
                  <div className="metric-bar metric-bar-violet"><i style={{ width: `${text}%` }} /></div>
                  <small>Extracted text comparison score</small>
                </div>

                <div className="metric-bar-row">
                  <div className="metric-bar-label">
                    <span><Fingerprint size={15} /> Visual processing</span>
                    <strong className="status-value">
                      {currentResult.visual_status || "UNKNOWN"}
                    </strong>
                  </div>
                  <div className="metric-status-note">
                    <span className="status-dot" />
                    Status reported by backend
                  </div>
                </div>
              </div>
            </div>

            <div className="results-lower-grid">
              <div className="result-panel">
                <div className="panel-heading">
                  <div className="panel-heading-icon"><Fingerprint size={17} /></div>
                  <div>
                    <span className="card-overline">APPLICATION NUMBER</span>
                    <h3>Number comparison</h3>
                  </div>
                </div>

                <div className="application-status">
                  <span className={`application-indicator ${
                    application?.status === "MATCH"
                      ? "application-match"
                      : application?.status === "DIFFERENT"
                        ? "application-different"
                        : ""
                  }`} />
                  <strong>{application?.status || "NOT DETECTED"}</strong>
                </div>

                <div className="number-columns">
                  <div>
                    <span>REFERENCE</span>
                    {(application?.reference_numbers ?? []).length ? (
                      application!.reference_numbers!.map((number, index) => (
                        <code key={`${number}-${index}`}>{number}</code>
                      ))
                    ) : <p>—</p>}
                  </div>
                  <div>
                    <span>COMPARISON</span>
                    {(application?.comparison_numbers ?? []).length ? (
                      application!.comparison_numbers!.map((number, index) => (
                        <code key={`${number}-${index}`}>{number}</code>
                      ))
                    ) : <p>—</p>}
                  </div>
                </div>

                <p className="panel-footnote">
                  Number extraction depends on labelled text patterns in the
                  submitted documents. Missing values do not mean a match.
                </p>
              </div>

              <div className="result-panel">
                <div className="panel-heading">
                  <div className="panel-heading-icon violet-panel-icon"><ScanSearch size={17} /></div>
                  <div>
                    <span className="card-overline">VISUAL EVIDENCE</span>
                    <h3>Detected regions</h3>
                  </div>
                  <span className="evidence-count">{regions.length}/{evidence?.max_regions ?? 4}</span>
                </div>

                {regions.length > 0 ? (
                  <div className="evidence-list">
                    {regions.slice(0, 4).map((region, index) => (
                      <div className="evidence-item" key={index}>
                        <span className="evidence-number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <strong>{region.label || `Region ${index + 1}`}</strong>
                          <small>
                            {region.x !== undefined
                              ? `x:${region.x} · y:${region.y} · w:${region.width} · h:${region.height}`
                              : "Coordinates not supplied"}
                          </small>
                        </div>
                        {region.confidence !== undefined && (
                          <b>{(region.confidence * 100).toFixed(1)}%</b>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="evidence-empty">
                    <div className="evidence-empty-icon"><ScanSearch size={24} /></div>
                    <strong>No localized regions returned</strong>
                    <p>
                      {evidence?.status === "REGION_LOCALIZATION_NOT_IMPLEMENTED"
                        ? "The current backend does not yet localize matching logo regions."
                        : "The API did not return visual evidence coordinates for this comparison."}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="result-panel source-panel">
              <div className="panel-heading">
                <div className="panel-heading-icon"><FileText size={17} /></div>
                <div>
                  <span className="card-overline">SOURCE DOCUMENTS</span>
                  <h3>Files processed</h3>
                </div>
              </div>

              {files.length ? (
                <div className="source-files">
                  {files.map((file, index) => (
                    <div className="source-file" key={`${file.name}-${index}`}>
                      <div className="source-file-icon"><FileText size={18} /></div>
                      <div className="source-file-name">
                        <strong>{file.name}</strong>
                        <span>{formatBytes(file.size_bytes)}</span>
                      </div>
                      <div className="source-file-images">
                        <ImageIcon size={14} />
                        {file.extracted_image_count ?? 0} images
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">The API did not return source file metadata.</p>
              )}
            </div>

            {(currentResult.limitations ?? []).length > 0 && (
              <div className="limitations-panel">
                <div className="limitations-icon"><ShieldCheck size={19} /></div>
                <div>
                  <span className="card-overline">IMPORTANT NOTES</span>
                  <h3>Assessment limitations</h3>
                  <ul>
                    {currentResult.limitations!.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
        )}

        <footer className="footer" id="system-status">
          <div className="footer-brand">
            <div className="footer-mark"><Fingerprint size={17} /></div>
            <span>APEXIVE AI</span>
            <i />
            <span>TRADEMARK INTELLIGENCE</span>
          </div>
          <div className="footer-center">
            <span className="status-dot" />
            TOKYO NODE / PORT 8017
          </div>
          <div className="footer-right">
            PRELIMINARY SCREENING
            <ChevronRight size={13} />
          </div>
        </footer>

        <div className="copyright">
          <span>© APEXIVE AI</span>
          <span>BUILT FOR BETTER BRAND DECISIONS</span>
          <span>東京 · 35.6762° N</span>
        </div>
      </div>
    </main>
  );
}