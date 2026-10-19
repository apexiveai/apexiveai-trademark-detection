import {
  useEffect,
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
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";

const API_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8017";
const LOGO_MATCHES_PER_PAGE = 100;

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
  side?: "reference" | "comparison";
  image_index?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  image_width?: number;
  image_height?: number;
  shape?: string;
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
  logo_matches?: LogoMatch[];
  logo_match_threshold?: number;
  visual_evidence?: {
    regions?: EvidenceRegion[];
    max_regions?: number;
    status?: string;
  };
  limitations?: string[];
};

type LogoMatch = {
  reference_image_index: number;
  comparison_image_index: number;
  reference_location: string;
  comparison_location: string;
  similarity: number;
};

type ApiResponse = {
  result: ComparisonResult;
  files?: FileInfo[];
};

type TrademarkMatch = {
  id: string;
  jurisdiction: string;
  mark_name: string;
  trademark_number: string;
  classes: string[];
  goods_services: string;
  source_url: string;
  logo_url: string;
  similarity: number;
  risk_level: string;
  signals: {
    embedding: number;
    shape: number;
    color: number;
    layout: number;
    text: number | null;
    class: number | null;
    visual: number;
  };
  evidence_region?: EvidenceRegion | null;
};

type TrademarkSearchResponse = {
  matches: TrademarkMatch[];
  scanned_candidates: number;
  query_evidence_region?: EvidenceRegion | null;
  coverage_note: string;
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

function isPreviewableImage(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|webp|svg)$/i.test(file.name)
  );
}

function getRegionOutline(region?: EvidenceRegion): CSSProperties | undefined {
  if (!region) return undefined;

  const { x, y, width, height, image_width, image_height } = region;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof image_width !== "number" ||
    typeof image_height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(image_width) ||
    !Number.isFinite(image_height) ||
    image_width <= 0 ||
    image_height <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }

  return {
    left: `${(x / image_width) * 100}%`,
    top: `${(y / image_height) * 100}%`,
    width: `${(width / image_width) * 100}%`,
    height: `${(height / image_height) * 100}%`,
  };
}

function EvidencePreview({
  file,
  region,
  label,
}: {
  file: File;
  region?: EvidenceRegion;
  label: string;
}) {
  const [source, setSource] = useState("");

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setSource(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const outline = getRegionOutline(region);

  return (
    <div className="evidence-image-wrap">
      {source && <img src={source} alt={`${label} uploaded logo`} />}
      {outline && (
        <span
          className="evidence-region-outline"
          aria-label="Detected logo region"
          style={outline}
        />
      )}
    </div>
  );
}

function RemoteEvidencePreview({
  source,
  region,
  label,
  token,
}: {
  source: string;
  region?: EvidenceRegion | null;
  label: string;
  token: string;
}) {
  const [imageUrl, setImageUrl] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    setImageUrl("");
    setLoadError("");
    void fetch(source, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Logo preview request failed (${response.status}).`);
        }
        return response.blob();
      })
      .then((image) => {
        objectUrl = URL.createObjectURL(image);
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else setImageUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Logo preview could not be loaded.",
          );
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, token]);

  const outline = getRegionOutline(region ?? undefined);
  return (
    imageUrl ? (
      <div className="evidence-image-wrap">
        <img src={imageUrl} alt={`${label} trademark logo`} />
        {outline && (
          <span
            className="evidence-region-outline"
            aria-label="Detected logo region"
            style={outline}
          />
        )}
      </div>
    ) : (
      <div className="evidence-preview-unavailable">
        <ImageIcon size={20} />
        <span>{loadError || "Loading trademark logo..."}</span>
      </div>
    )
  );
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
  const [logoMatchPage, setLogoMatchPage] = useState(1);
  const [error, setError] = useState("");
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [searchLogo, setSearchLogo] = useState<File | null>(null);
  const [searchMarkName, setSearchMarkName] = useState("");
  const [searchGoods, setSearchGoods] = useState("");
  const [searchClasses, setSearchClasses] = useState("");
  const [searchJurisdictions, setSearchJurisdictions] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<TrademarkSearchResponse | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [communityManagedAccess, setCommunityManagedAccess] = useState(false);
  const [authToken, setAuthToken] = useState(() => sessionStorage.getItem("apexive-session") || "");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");

  const canUseWorkspace = !authRequired || Boolean(authToken);
  const canCompare = Boolean(fileA && fileB && !loading && canUseWorkspace);
  const canSearch = Boolean(searchLogo && !searchLoading && canUseWorkspace);
  const jurisdictions = ["MYANMAR", "WIPO", "EUIPO", "TMVIEW", "USPTO"];
  const productHighlights = [
    {
      icon: ShieldCheck,
      title: "Tenant-first security",
      description: "Controlled access, role-aware accounts, and production-ready deployment hardening for client workspaces.",
    },
    {
      icon: ScanSearch,
      title: "Visual + text screening",
      description: "Compare documents, spreadsheets, and logo images using extracted layout and similarity evidence.",
    },
    {
      icon: Gauge,
      title: "Actionable outputs",
      description: "Get similarity scores, visual evidence circles, and per-page or per-sheet match references.",
    },
    {
      icon: Sparkles,
      title: "Commercial readiness",
      description: "Built for law firms, brand teams, and managed community tenants that need a polished client-facing product.",
    },
  ];
  const pricingPlans = [
    {
      name: "Community",
      price: "$0",
      period: "/ month",
      description: "For individual reviewers and early pilots.",
      features: ["1 tenant workspace", "5 comparisons / month", "Basic exports"],
      featured: false,
    },
    {
      name: "Growth",
      price: "$49",
      period: "/ month",
      description: "For active teams screening trademarks weekly.",
      features: ["Unlimited comparisons", "Priority screening queue", "PDF export", "Audit log"],
      featured: true,
    },
    {
      name: "Enterprise",
      price: "$199",
      period: "/ month",
      description: "For firms with managed tenant teams and legal review workflows.",
      features: ["Unlimited tenants", "SSO and policy controls", "Custom reports", "Dedicated onboarding"],
      featured: false,
    },
  ];
  const legalNotes = [
    "This platform provides preliminary screening signals only, not legal advice.",
    "Every result should be reviewed by a qualified trademark professional before action.",
    "Customer data is retained according to the tenant policy and export retention controls.",
  ];

  const checkApi = async () => {
    try {
      const response = await fetch(`${API_URL}/health`);
      setApiOnline(response.ok);
      if (response.ok) {
        const status = await response.json();
        setAuthRequired(status.auth_required === true);
        setCommunityManagedAccess(status.community_access_managed === true);
      }
    } catch {
      setApiOnline(false);
    }
  };

  useEffect(() => {
    void checkApi();
    const verificationToken = new URLSearchParams(window.location.search).get("verify");
    if (!verificationToken) return;
    void fetch(`${API_URL}/api/v1/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: verificationToken }),
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(typeof payload.detail === "string" ? payload.detail : "Email verification failed.");
        }
        setAuthEmail(payload.email || "");
        setAuthMessage("Email verified. Sign in to continue.");
        setAuthMode("login");
      })
      .catch((err: unknown) => {
        setAuthMessage(
          err instanceof Error ? err.message : "Email verification failed.",
        );
      })
      .finally(() => {
        const url = new URL(window.location.href);
        url.searchParams.delete("verify");
        window.history.replaceState({}, "", url);
      });
  }, []);

  useEffect(() => {
    const launchUrl = new URL(window.location.href);
    const launchParams = new URLSearchParams(launchUrl.hash.slice(1));
    const communityToken = launchParams.get("community_token");
    if (!communityToken) return;

    launchParams.delete("community_token");
    launchUrl.hash = launchParams.toString();
    window.history.replaceState(
      null,
      "",
      `${launchUrl.pathname}${launchUrl.search}${launchUrl.hash}`,
    );
    sessionStorage.setItem("apexive-session", communityToken);
    setAuthToken(communityToken);
  }, []);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthMessage("");
    try {
      const response = await fetch(`${API_URL}/api/v1/auth/${authMode === "register" ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.detail === "string" ? payload.detail : "Account request failed.");
      }
      if (authMode === "register") {
        setAuthMessage("Verification email sent. Open its link to activate your account.");
        setAuthMode("login");
        setAuthPassword("");
      } else {
        const token = payload.access_token;
        if (typeof token !== "string" || !token) {
          throw new Error("Sign-in response did not contain an access token.");
        }
        sessionStorage.setItem("apexive-session", token);
        setAuthToken(token);
        setAuthPassword("");
        setAuthMessage("Signed in successfully.");
      }
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Account request failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = () => {
    sessionStorage.removeItem("apexive-session");
    setAuthToken("");
    setAuthMessage("Signed out.");
  };

  const exportReport = () => {
    if (typeof window !== "undefined") {
      window.print();
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
    setLogoMatchPage(1);

    try {
      const formData = new FormData();
      formData.append("file_a", fileA);
      formData.append("file_b", fileB);

      const response = await fetch(`${API_URL}/api/v1/compare`, {
        method: "POST",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
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

  const searchTrademarks = async () => {
    if (!searchLogo) {
      setSearchError("Upload a logo image to search the trademark index.");
      return;
    }

    setSearchLoading(true);
    setSearchError("");
    setSearchResults(null);
    try {
      const formData = new FormData();
      formData.append("image", searchLogo);
      formData.append("mark_name", searchMarkName);
      formData.append("goods_services", searchGoods);
      formData.append("classes", searchClasses);
      formData.append("limit", "10");
      searchJurisdictions.forEach((jurisdiction) => {
        formData.append("jurisdictions", jurisdiction);
      });
      const response = await fetch(`${API_URL}/api/v1/trademarks/search`, {
        method: "POST",
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof payload.detail === "string"
            ? payload.detail
            : "Trademark search failed.",
        );
      }
      setSearchResults(payload as TrademarkSearchResponse);
      setApiOnline(true);
      window.setTimeout(() => {
        document
          .getElementById("trademark-search-results")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setSearchError(
        err instanceof Error
          ? `${err.message}. Check that the local embedding model and vector index are configured.`
          : "Trademark search could not be completed.",
      );
      setApiOnline(false);
    } finally {
      setSearchLoading(false);
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
  const logoMatches = currentResult?.logo_matches ?? [];
  const logoMatchPageCount = Math.max(
    1,
    Math.ceil(logoMatches.length / LOGO_MATCHES_PER_PAGE),
  );
  const visibleLogoMatches = logoMatches.slice(
    (logoMatchPage - 1) * LOGO_MATCHES_PER_PAGE,
    logoMatchPage * LOGO_MATCHES_PER_PAGE,
  );

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
            <a className="nav-link nav-link-active" href="#community">
              Community
            </a>
            <a className="nav-link" href="#workspace">
              Workspace
            </a>
            <a className="nav-link" href="#pricing">
              Pricing
            </a>
            <a className="nav-link" href="#legal">
              Legal
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

        <section className="community-hero" id="community">
          <div className="community-copy">
            <div className="eyebrow">
              <span className="eyebrow-line" />
              APEXIVEAI COMMUNITY / TENANT ACCESS
            </div>
            <h1>Trusted trademark clearance for modern brand teams.</h1>
            <p className="hero-description">
              ApexiveAI Community brings tenant-aware comparison workflows,
              subscription-ready delivery, and polished report output for teams
              screening marks, logos, and document submissions with confidence.
            </p>
            <div className="community-actions">
              <a className="hero-cta" href="#workspace">
                <span>Open workspace</span>
                <ArrowUpRight size={16} />
              </a>
              <a className="secondary-cta" href="#pricing">
                View subscriptions
              </a>
            </div>
            <div className="hero-proof">
              <div className="proof-icon"><ShieldCheck size={16} /></div>
              <span>COMMUNITY TENANTS</span>
              <i />
              <span>LEGAL SCREENING</span>
              <i />
              <span>REPORT EXPORT</span>
            </div>
          </div>

          <div className="community-panel">
            <div className="tenant-card">
              <div className="tenant-row">
                <span>Tenant</span>
                <strong>ApexiveAI Community</strong>
              </div>
              <div className="tenant-row">
                <span>Plan</span>
                <strong>Growth</strong>
              </div>
              <div className="tenant-row">
                <span>Seats</span>
                <strong>8 active reviewers</strong>
              </div>
              <div className="tenant-row">
                <span>Storage</span>
                <strong>12.4 GB retained</strong>
              </div>
              <div className="tenant-plan-grid">
                <span className="plan-pill active">Starter</span>
                <span className="plan-pill">Growth</span>
                <span className="plan-pill">Enterprise</span>
              </div>
              <button type="button" className="tenant-button compare-button">
                <ShieldCheck size={15} /> Manage subscriptions
              </button>
            </div>
          </div>
        </section>

        <section className="feature-grid" aria-label="Product advantages">
          {productHighlights.map(({ icon: Icon, title, description }) => (
            <article key={title} className="feature-card">
              <div className="feature-icon"><Icon size={18} /></div>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </section>

        <section className="pricing-panel" id="pricing">
          <div className="section-heading section-heading-compact">
            <div>
              <div className="section-kicker"><span>00</span> / SUBSCRIPTIONS</div>
              <h2>Pricing <span>for teams</span></h2>
            </div>
            <div className="result-badge"><CheckCircle2 size={15} /> TENANT READY</div>
          </div>
          <div className="pricing-grid">
            {pricingPlans.map(({ name, price, period, description, features, featured }) => (
              <article key={name} className={`pricing-card ${featured ? "featured" : ""}`}>
                <div className="pricing-header">
                  <span>{name}</span>
                  <strong>{price}<small>{period}</small></strong>
                </div>
                <p>{description}</p>
                <ul>
                  {features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <button type="button" className="secondary-cta pricing-button">
                  {featured ? "Choose Growth" : "Select plan"}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="community-legal" id="legal">
          <div className="section-heading section-heading-compact">
            <div>
              <div className="section-kicker"><span>00</span> / LEGAL + COMPLIANCE</div>
              <h2>Business <span>guardrails</span></h2>
            </div>
            <div className="result-badge"><ShieldCheck size={15} /> PRELIMINARY ONLY</div>
          </div>
          <div className="legal-note-grid">
            {legalNotes.map((note) => (
              <div key={note} className="legal-note-card">
                <ShieldCheck size={16} />
                <span>{note}</span>
              </div>
            ))}
          </div>
        </section>

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
              <p>Compare two marks, or search the imported trademark vector index.</p>
            </div>
            <div className="section-status">
              <span className="status-ring"><span /></span>
              READY TO ANALYZE
            </div>
          </div>

          {(authRequired || communityManagedAccess) && (
            <div className="auth-panel">
              <div className="auth-panel-heading">
                <div>
                  <span className="card-overline">COMMUNITY ACCESS</span>
                  <h3>
                    {communityManagedAccess
                      ? "Tenant access is managed by ApexiveAI Community"
                      : authToken
                        ? "Verified account session"
                        : "Email account required"}
                  </h3>
                </div>
                {!communityManagedAccess && (authToken ? (
                  <button className="auth-action-button" type="button" onClick={signOut}>SIGN OUT</button>
                ) : (
                  <div className="auth-mode-switch">
                    <button
                      className={authMode === "login" ? "active" : ""}
                      type="button"
                      onClick={() => { setAuthMode("login"); setAuthMessage(""); }}
                    >SIGN IN</button>
                    <button
                      className={authMode === "register" ? "active" : ""}
                      type="button"
                      onClick={() => { setAuthMode("register"); setAuthMessage(""); }}
                    >CREATE ACCOUNT</button>
                  </div>
                ))}
              </div>
              {communityManagedAccess ? (
                <p className="auth-session-copy">
                  Access to this product is controlled by the ApexiveAI Community tenant dashboard. A SuperAdmin must grant the tenant subscription before this workspace can be opened.
                </p>
              ) : authToken ? (
                <p className="auth-session-copy">{authEmail || "Your verified session is active."}</p>
              ) : (
                <form className="auth-form" onSubmit={submitAuth}>
                  <label>
                    EMAIL
                    <input
                      type="email"
                      autoComplete="email"
                      required
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                    />
                  </label>
                  <label>
                    PASSWORD
                    <input
                      type="password"
                      autoComplete={authMode === "register" ? "new-password" : "current-password"}
                      minLength={authMode === "register" ? 12 : undefined}
                      maxLength={128}
                      required
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                    />
                  </label>
                  <button className="auth-action-button" type="submit" disabled={authLoading}>
                    {authLoading ? "PLEASE WAIT..." : authMode === "register" ? "SEND VERIFICATION" : "SIGN IN"}
                  </button>
                </form>
              )}
              {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
              {!canUseWorkspace && !communityManagedAccess && (
                <p className="auth-session-copy">Verify your email and sign in before submitting a logo or document.</p>
              )}
            </div>
          )}

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

          <div className="database-search">
            <div className="database-search-heading">
              <div>
                <span className="card-overline">TRADEMARK DB / TOP 10 SEARCH</span>
                <h3>Search by logo embedding</h3>
                <p>Find the closest marks in your imported registry records.</p>
              </div>
              <div className="small-icon violet-small"><Search size={18} /></div>
            </div>

            <div className="search-fields">
              <label className="search-logo-input">
                <span>LOGO IMAGE</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(event) => {
                    setSearchLogo(event.target.files?.[0] ?? null);
                    setSearchResults(null);
                  }}
                />
                {searchLogo && <small>{searchLogo.name} · {formatBytes(searchLogo.size)}</small>}
              </label>
              <label>
                <span>MARK NAME (OPTIONAL)</span>
                <input
                  value={searchMarkName}
                  onChange={(event) => setSearchMarkName(event.target.value)}
                  maxLength={300}
                  placeholder="e.g. SILIER"
                />
              </label>
              <label>
                <span>NICE CLASS(ES)</span>
                <input
                  value={searchClasses}
                  onChange={(event) => setSearchClasses(event.target.value)}
                  placeholder="e.g. 9, 25"
                />
              </label>
              <label className="search-goods">
                <span>GOODS &amp; SERVICES (OPTIONAL)</span>
                <input
                  value={searchGoods}
                  onChange={(event) => setSearchGoods(event.target.value)}
                  maxLength={4000}
                  placeholder="Describe the relevant products or services"
                />
              </label>
            </div>

            <div className="jurisdiction-filters" aria-label="Trademark jurisdictions">
              <span>SEARCH CORPUS</span>
              {jurisdictions.map((jurisdiction) => (
                <label key={jurisdiction}>
                  <input
                    type="checkbox"
                    checked={searchJurisdictions.includes(jurisdiction)}
                    onChange={(event) => setSearchJurisdictions((current) =>
                      event.target.checked
                        ? [...current, jurisdiction]
                        : current.filter((item) => item !== jurisdiction),
                    )}
                  />
                  {jurisdiction}
                </label>
              ))}
            </div>

            <div className="workspace-actions">
              <div className="upload-guidance">
                <ShieldCheck size={16} />
                <span>Only trademarks already imported into the vector database are searched.</span>
              </div>
              <button
                className="compare-button"
                type="button"
                disabled={!canSearch}
                onClick={searchTrademarks}
              >
                {searchLoading ? (
                  <><LoaderCircle size={18} className="spin" /> SEARCHING INDEX...</>
                ) : (
                  <><Search size={17} /> FIND TOP 10 <ArrowUpRight size={17} /></>
                )}
              </button>
            </div>
            {searchError && <div className="error-message" role="alert"><X size={17} /><span>{searchError}</span></div>}
          </div>
        </section>

        {searchResults && (
          <section className="database-results" id="trademark-search-results">
            <div className="section-heading">
              <div>
                <div className="section-kicker"><span>02</span> / VECTOR SEARCH</div>
                <h2>Top <span>matches</span></h2>
                <p>
                  {searchResults.matches.length} matches from {searchResults.scanned_candidates} vector candidates
                  · local CLIP embedding.
                </p>
              </div>
              <div className="result-badge"><CheckCircle2 size={15} /> TOP 10 SEARCH</div>
            </div>

            {searchResults.matches.length ? (
              <div className="trademark-match-list">
                {searchResults.matches.map((match, index) => (
                  <article className="trademark-match-card" key={match.id}>
                    <div className="trademark-match-heading">
                      <span className="match-rank">#{String(index + 1).padStart(2, "0")}</span>
                      <div className="match-title">
                        <h3>{match.mark_name}</h3>
                        <p>{match.jurisdiction} · {match.trademark_number || "No number supplied"}</p>
                      </div>
                      <span className={`risk-badge ${getRiskClass(match.risk_level)}`}>
                        <span /> {match.risk_level} RISK
                      </span>
                      <strong className="match-score">{match.similarity.toFixed(1)}%</strong>
                    </div>

                    <div className="match-side-by-side">
                      <div className="match-logo-panel">
                        <span>QUERY LOGO · DETECTED REGION</span>
                        {searchLogo && (
                          <EvidencePreview
                            file={searchLogo}
                            region={searchResults.query_evidence_region ?? undefined}
                            label="Search query"
                          />
                        )}
                      </div>
                      <div className="match-arrow"><ArrowLeftRight size={17} /></div>
                      <div className="match-logo-panel">
                        <span>REGISTERED MARK · EVIDENCE CIRCLE</span>
                        <RemoteEvidencePreview
                          source={`${API_URL}${match.logo_url}`}
                          region={match.evidence_region}
                          label={match.mark_name}
                          token={authToken}
                        />
                      </div>
                    </div>

                    <div className="match-metadata">
                      <div><span>NICE CLASS</span><strong>{match.classes.length ? match.classes.join(", ") : "Not supplied"}</strong></div>
                      <div className="match-goods"><span>GOODS &amp; SERVICES</span><strong>{match.goods_services || "Not supplied"}</strong></div>
                      {match.source_url && (
                        <a href={match.source_url} target="_blank" rel="noreferrer">
                          OPEN SOURCE RECORD <ArrowUpRight size={13} />
                        </a>
                      )}
                    </div>

                    <div className="match-signals">
                      <span>AI LOGO {match.signals.embedding.toFixed(0)}%</span>
                      <span>SHAPE {match.signals.shape.toFixed(0)}%</span>
                      <span>COLOR {match.signals.color.toFixed(0)}%</span>
                      <span>LAYOUT {match.signals.layout.toFixed(0)}%</span>
                      {match.signals.text !== null && <span>TEXT {match.signals.text.toFixed(0)}%</span>}
                      {match.signals.class !== null && <span>CLASS {match.signals.class.toFixed(0)}%</span>}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="evidence-empty">
                <div className="evidence-empty-icon"><ScanSearch size={24} /></div>
                <strong>No indexed trademarks matched these filters</strong>
                <p>Import licensed registry records for Myanmar, WIPO, EUIPO/TMview, or USPTO, then search again.</p>
              </div>
            )}
            <p className="coverage-note">{searchResults.coverage_note}</p>
          </section>
        )}

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
                <div className="section-kicker"><span>03</span> / ANALYSIS OUTPUT</div>
                <h2>Intelligence <span>report</span></h2>
                <p>Scores returned by the current backend comparison engine.</p>
              </div>
              <div className="result-actions">
                <button className="export-report-button" type="button" onClick={exportReport}>
                  <FileText size={15} /> EXPORT REPORT
                </button>
                <div className="result-badge">
                  <CheckCircle2 size={15} />
                  ANALYSIS RECEIVED
                </div>
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

            <div className="result-panel logo-matches-panel">
              <div className="panel-heading">
                <div className="panel-heading-icon"><ScanSearch size={17} /></div>
                <div>
                  <span className="card-overline">VISUAL LOGO MATCHES</span>
                  <h3>Similar logos by page or sheet</h3>
                </div>
                <span className="evidence-count">
                  {logoMatches.length} match{logoMatches.length === 1 ? "" : "es"}
                </span>
              </div>
              <p className="logo-matches-note">
                Showing every image pair scoring at least{" "}
                {currentResult.logo_match_threshold ?? 80}% similarity, sorted
                from highest to lowest. Up to 100 matches are shown per page.
              </p>

              {visibleLogoMatches.length ? (
                <>
                  <div className="logo-match-list">
                    {visibleLogoMatches.map((match, index) => {
                      const matchNumber =
                        (logoMatchPage - 1) * LOGO_MATCHES_PER_PAGE + index + 1;
                      return (
                        <article className="logo-match-card" key={`${match.reference_image_index}-${match.comparison_image_index}`}>
                          <span className="logo-match-rank">
                            #{String(matchNumber).padStart(3, "0")}
                          </span>
                          <div className="logo-match-source">
                            <small>{files[0]?.name || "Reference file"}</small>
                            <strong>{match.reference_location}</strong>
                          </div>
                          <ArrowLeftRight className="logo-match-arrow" size={17} />
                          <div className="logo-match-source">
                            <small>{files[1]?.name || "Comparison file"}</small>
                            <strong>{match.comparison_location}</strong>
                          </div>
                          <strong className="logo-match-score">
                            {match.similarity.toFixed(1)}%
                          </strong>
                        </article>
                      );
                    })}
                  </div>
                  {logoMatchPageCount > 1 && (
                    <nav className="logo-match-pagination" aria-label="Logo match pages">
                      <button
                        type="button"
                        disabled={logoMatchPage === 1}
                        onClick={() => setLogoMatchPage((page) => Math.max(1, page - 1))}
                      >
                        <ChevronRight className="pagination-previous" size={15} />
                        Previous
                      </button>
                      <span>PAGE {logoMatchPage} OF {logoMatchPageCount}</span>
                      <button
                        type="button"
                        disabled={logoMatchPage === logoMatchPageCount}
                        onClick={() =>
                          setLogoMatchPage((page) =>
                            Math.min(logoMatchPageCount, page + 1),
                          )
                        }
                      >
                        Next
                        <ChevronRight size={15} />
                      </button>
                    </nav>
                  )}
                </>
              ) : (
                <div className="evidence-empty logo-matches-empty">
                  <div className="evidence-empty-icon"><ScanSearch size={24} /></div>
                  <strong>No logo pairs reached the similarity threshold</strong>
                  <p>
                    The files were checked, but no extracted image pairs scored
                    at least {currentResult.logo_match_threshold ?? 80}%.
                  </p>
                </div>
              )}
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

                {fileA && fileB && (
                  <div className="evidence-previews">
                    {[
                      { side: "reference" as const, file: fileA, label: "Reference" },
                      { side: "comparison" as const, file: fileB, label: "Comparison" },
                    ].map(({ side, file, label }) => {
                      const region = regions.find(
                        (item) => item.side === side && item.image_index === 1,
                      );

                      return (
                        <article className="evidence-preview-card" key={side}>
                          <strong>{label} logo</strong>
                          {isPreviewableImage(file) ? (
                            <EvidencePreview
                              file={file}
                              region={region}
                              label={label}
                            />
                          ) : (
                            <div className="evidence-preview-unavailable">
                              <ImageIcon size={20} />
                              <span>Image preview is unavailable for this file type.</span>
                            </div>
                          )}
                          <small>
                            {region
                              ? `Detected region · x:${region.x} y:${region.y} w:${region.width} h:${region.height}`
                              : "No region coordinates returned"}
                          </small>
                        </article>
                      );
                    })}
                  </div>
                )}

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