"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { BaseModal } from "@/components/BaseModal";
import { LoadingState } from "@/components/LoadingState";
import { ApiError, api, type RawFlexReport, type SyncJob, type SyncRun, type SyncSchedule, type SyncStatus } from "@/lib/api";
import { formatDisplayDateTime } from "@/lib/format";

const IBKR_JOB_KEY = "ibkr_flex_sync";
const SYMBOL_JOB_KEY = "nasdaq_symbol_sync";
const SYNC_JOB_KEYS = [IBKR_JOB_KEY, SYMBOL_JOB_KEY] as const;
const DEFAULT_TIMEZONE = "Asia/Taipei";

type SyncJobKey = (typeof SYNC_JOB_KEYS)[number];
type RunsByJob = Record<SyncJobKey, SyncRun[]>;
type JobMessages = Partial<Record<SyncJobKey, string>>;
type JobScheduleForm = {
  enabled: boolean;
  useShared: boolean;
  time: string;
  timezone: string;
  weekdaysOnly: boolean;
};
type JobScheduleForms = Record<SyncJobKey, JobScheduleForm>;

const emptyRunsByJob: RunsByJob = {
  [IBKR_JOB_KEY]: [],
  [SYMBOL_JOB_KEY]: [],
};

const emptyJobScheduleForms: JobScheduleForms = {
  [IBKR_JOB_KEY]: {
    enabled: true,
    useShared: true,
    time: "14:30",
    timezone: DEFAULT_TIMEZONE,
    weekdaysOnly: true,
  },
  [SYMBOL_JOB_KEY]: {
    enabled: true,
    useShared: true,
    time: "14:30",
    timezone: DEFAULT_TIMEZONE,
    weekdaysOnly: true,
  },
};

const DEMO_SCHEDULE: SyncSchedule = {
  daily_sync_time: "14:30",
  timezone_name: DEFAULT_TIMEZONE,
  weekdays_only: true,
  last_auto_sync_date: "2026-06-19",
  updated_at: "2026-06-19T14:07:00+08:00",
};

function demoJob(jobKey: SyncJobKey, displayName: string): SyncJob {
  return {
    job_key: jobKey,
    display_name: displayName,
    enabled: true,
    use_shared_schedule: true,
    schedule_type: "daily",
    daily_sync_time: null,
    weekdays_only: null,
    cron_expression: null,
    timezone: null,
    last_auto_sync_date: "2026-06-19",
    last_run_at: "2026-06-19T14:07:00+08:00",
    next_run_at: "2026-06-20T14:30:00+08:00",
    status: "success",
    created_at: "2026-05-01T08:00:00+08:00",
    updated_at: "2026-06-19T14:07:00+08:00",
  };
}

function demoRun(overrides: Partial<SyncRun> & Pick<SyncRun, "id" | "job_key" | "started_at">): SyncRun {
  return {
    finished_at: overrides.started_at,
    status: "success",
    duration_ms: 2120,
    rows_total: null,
    rows_inserted: null,
    rows_updated: null,
    rows_deleted: null,
    artifact_path: null,
    error_message: null,
    metadata_json: null,
    created_at: overrides.started_at,
    message: "Synchronization completed successfully.",
    report_date: null,
    raw_flex_report_id: null,
    ...overrides,
  };
}

const DEMO_JOBS: SyncJob[] = [
  demoJob(IBKR_JOB_KEY, "IBKR Flex Reports"),
  demoJob(SYMBOL_JOB_KEY, "Nasdaq Symbol Directory"),
];

const DEMO_RUNS: RunsByJob = {
  [IBKR_JOB_KEY]: [
    demoRun({
      id: 101,
      job_key: IBKR_JOB_KEY,
      started_at: "2026-06-19T14:07:00+08:00",
      rows_total: 20,
      rows_inserted: 17,
      rows_updated: 3,
      artifact_path: "/app/storage/raw_xml/flex_1490496_20260619.xml",
      report_date: "2026-06-19",
      raw_flex_report_id: 49,
      metadata_json: { positions_lot: 17, cash_activities: 3 },
    }),
    demoRun({
      id: 99,
      job_key: IBKR_JOB_KEY,
      started_at: "2026-06-18T14:07:00+08:00",
      rows_total: 18,
      rows_inserted: 16,
      rows_updated: 2,
      report_date: "2026-06-18",
    }),
  ],
  [SYMBOL_JOB_KEY]: [
    demoRun({
      id: 102,
      job_key: SYMBOL_JOB_KEY,
      started_at: "2026-06-19T14:08:00+08:00",
      rows_total: 12840,
      rows_inserted: 2,
      rows_updated: 31,
      artifact_path: "/app/storage/symbols/nasdaq_20260619.csv",
    }),
    demoRun({
      id: 98,
      job_key: SYMBOL_JOB_KEY,
      started_at: "2026-06-18T14:08:00+08:00",
      rows_total: 12838,
      rows_inserted: 4,
      rows_updated: 26,
    }),
  ],
};

const DEMO_STATUS: SyncStatus = {
  latest_run: DEMO_RUNS[IBKR_JOB_KEY][0],
  latest_raw_flex_report: {
    id: 49,
    report_date: "2026-06-19",
    query_id: "demo",
    xml_path: "/app/storage/raw_xml/flex_1490496_20260619.xml",
    xml_sha256: "preview",
    downloaded_at: "2026-06-19T14:07:00+08:00",
    status: "parsed",
    error_message: null,
  },
};

function sanitizeMessage(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }
  const tokenConfigName = ["IBKR", "TOKEN"].join("_");
  return value.replaceAll(tokenConfigName, "IBKR credential");
}

function displayMessage(value: string | null | undefined): string {
  const sanitized = sanitizeMessage(value);
  return sanitized === "--" ? "No message recorded." : sanitized;
}

function statusLabel(value: string | null | undefined): string {
  if (!value) {
    return "Unknown";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isSuccessful(value: string | null | undefined): boolean {
  const normalized = value?.toLowerCase();
  return normalized === "success" || normalized === "duplicate";
}

function isRunning(run: SyncRun | null | undefined): boolean {
  return run?.status?.toLowerCase() === "running" && !run.finished_at;
}

function latestSuccessfulRun(runs: SyncRun[]): SyncRun | null {
  return runs.find((run) => isSuccessful(run.status)) ?? null;
}

function latestErrorMessage(run: SyncRun | null | undefined, fallback?: string | null): string {
  if (run?.error_message) {
    return sanitizeMessage(run.error_message);
  }
  if (run?.status.toLowerCase() === "failed" && run.message) {
    return displayMessage(run.message);
  }
  if (fallback) {
    return sanitizeMessage(fallback);
  }
  return "No recent error.";
}

function jobByKey(jobs: SyncJob[], jobKey: SyncJobKey): SyncJob | null {
  return jobs.find((job) => job.job_key === jobKey) ?? null;
}

function scheduleHint(schedule: SyncSchedule | null): string {
  if (!schedule) {
    return "--";
  }
  return `${schedule.weekdays_only ? "Weekdays" : "Every day"} at ${schedule.daily_sync_time}`;
}

function jobTitle(jobKey: SyncJobKey): string {
  return jobKey === IBKR_JOB_KEY ? "IBKR Flex Reports" : "Nasdaq Symbol Directory";
}

function buildJobScheduleForms(jobs: SyncJob[], sharedSchedule: SyncSchedule): JobScheduleForms {
  return SYNC_JOB_KEYS.reduce((forms, jobKey) => {
    const job = jobByKey(jobs, jobKey);
    forms[jobKey] = {
      enabled: job?.enabled ?? true,
      useShared: job?.use_shared_schedule ?? true,
      time: job?.daily_sync_time ?? sharedSchedule.daily_sync_time,
      timezone: job?.timezone ?? sharedSchedule.timezone_name,
      weekdaysOnly: job?.weekdays_only ?? sharedSchedule.weekdays_only,
    };
    return forms;
  }, { ...emptyJobScheduleForms });
}

function jobScheduleSummary(job: SyncJob | null, sharedSchedule: SyncSchedule | null): string {
  if (!job || !sharedSchedule) {
    return "--";
  }
  if (job.use_shared_schedule) {
    return `${scheduleHint(sharedSchedule)} · ${sharedSchedule.timezone_name}`;
  }
  const cadence = job.weekdays_only ? "Weekdays" : "Every day";
  return `${cadence} at ${job.daily_sync_time ?? "--"} · ${job.timezone ?? sharedSchedule.timezone_name}`;
}

function validateScheduleTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? "--" : value.toLocaleString();
}

function formatTime(value: string | null | undefined): string {
  if (!value) {
    return "--:--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatRelativeTime(value: string | null | undefined, isDemo: boolean): string {
  if (isDemo) {
    return "23 min ago";
  }
  if (!value) {
    return "No successful run yet";
  }
  const milliseconds = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) {
    return "Recently";
  }
  const minutes = Math.max(0, Math.round(milliseconds / 60000));
  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function fileName(path: string | null | undefined): string {
  if (!path) {
    return "No archived report";
  }
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function metadataNumber(run: SyncRun | null, key: string): number | null {
  const value = run?.metadata_json?.[key];
  return typeof value === "number" ? value : null;
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <rect height="15" rx="2" width="17" x="3.5" y="5.5" />
      <path d="M7.5 3v5M16.5 3v5M3.5 10h17M8 14h3M8 17h6" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M18.2 9A7 7 0 0 0 6.4 6.4L4 9M5.8 15A7 7 0 0 0 17.6 17.6L20 15" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="m6.5 12.5 3.4 3.3 7.7-8" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="m9 7 8 5-8 5z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M5 12h13M14 7l5 5-5 5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 16h6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.1" />
    </svg>
  );
}

function SyncPipelineIllustration() {
  return (
    <svg aria-hidden="true" className="sync-pipeline-art" viewBox="0 0 520 330">
      <defs>
        <linearGradient id="sync-platform" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f8f3eb" />
          <stop offset="1" stopColor="#e9dfd0" />
        </linearGradient>
        <filter id="sync-shadow" height="160%" width="160%" x="-30%" y="-30%">
          <feDropShadow dx="0" dy="12" floodColor="#6e5847" floodOpacity=".13" stdDeviation="10" />
        </filter>
      </defs>
      <path d="m74 175 177-107a20 20 0 0 1 21 0l178 107a20 20 0 0 1 0 34L272 316a20 20 0 0 1-21 0L74 209a20 20 0 0 1 0-34Z" fill="url(#sync-platform)" stroke="#ded3c4" />
      <path d="M125 184 260 265 396 184" fill="none" stroke="#837a70" strokeDasharray="4 9" strokeLinecap="round" />
      <path d="M260 112v153" fill="none" stroke="#837a70" strokeDasharray="4 9" strokeLinecap="round" />
      <g filter="url(#sync-shadow)">
        <path d="m76 154 61-37a14 14 0 0 1 15 0l62 37a14 14 0 0 1 0 24l-62 37a14 14 0 0 1-15 0l-61-37a14 14 0 0 1 0-24Z" fill="#faf7f1" stroke="#ddd2c3" />
        <path d="m307 154 61-37a14 14 0 0 1 15 0l62 37a14 14 0 0 1 0 24l-62 37a14 14 0 0 1-15 0l-61-37a14 14 0 0 1 0-24Z" fill="#faf7f1" stroke="#ddd2c3" />
        <path d="m191 244 61-37a14 14 0 0 1 15 0l62 37a14 14 0 0 1 0 24l-62 37a14 14 0 0 1-15 0l-61-37a14 14 0 0 1 0-24Z" fill="#faf7f1" stroke="#ddd2c3" />
        <circle cx="260" cy="128" fill="#faf9f5" r="54" stroke="#e5dbcf" />
      </g>
      <g fill="#24221f" fontFamily="Inter, sans-serif" textAnchor="middle">
        <text fontSize="16" fontWeight="650" x="145" y="160">IBKR</text>
        <text fill="#6c6a64" fontSize="12" x="145" y="179">Reports</text>
        <text fontSize="16" fontWeight="650" x="376" y="160">Nasdaq</text>
        <text fill="#6c6a64" fontSize="12" x="376" y="179">Symbols</text>
        <text fontSize="15" fontWeight="650" x="260" y="252">Portfolio</text>
        <text fill="#6c6a64" fontSize="12" x="260" y="271">Intelligence</text>
      </g>
      <g fill="none" stroke="#292723" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3">
        <path d="M243 115a21 21 0 0 1 34-5l5 6M282 106v10h-10M278 141a21 21 0 0 1-34 5l-5-6M239 150v-10h10" />
      </g>
    </svg>
  );
}

export function SyncView() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [runsByJob, setRunsByJob] = useState<RunsByJob>(emptyRunsByJob);
  const [schedule, setSchedule] = useState<SyncSchedule | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);
  const [runningJob, setRunningJob] = useState<SyncJobKey | null>(null);
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [expandedSource, setExpandedSource] = useState<SyncJobKey | null>(null);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("14:30");
  const [scheduleTimezone, setScheduleTimezone] = useState(DEFAULT_TIMEZONE);
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [jobScheduleForms, setJobScheduleForms] = useState<JobScheduleForms>(emptyJobScheduleForms);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [jobMessages, setJobMessages] = useState<JobMessages>({});

  function applySyncData(statusData: SyncStatus, scheduleData: SyncSchedule, jobsData: SyncJob[], runData: RunsByJob) {
    setStatus(statusData);
    setSchedule(scheduleData);
    setScheduleTime(scheduleData.daily_sync_time);
    setScheduleTimezone(scheduleData.timezone_name);
    setWeekdaysOnly(scheduleData.weekdays_only);
    setJobs(jobsData);
    setJobScheduleForms(buildJobScheduleForms(jobsData, scheduleData));
    setRunsByJob(runData);
  }

  async function loadSyncCenter() {
    const [statusData, scheduleData, jobsData] = await Promise.all([api.syncStatus(), api.syncSchedule(), api.syncJobs()]);
    const runsEntries = await Promise.all(
      SYNC_JOB_KEYS.map(async (jobKey) => [jobKey, await api.syncJobRuns(jobKey, { limit: 20 })] as const),
    );
    applySyncData(statusData, scheduleData, jobsData, {
      [IBKR_JOB_KEY]: runsEntries.find(([jobKey]) => jobKey === IBKR_JOB_KEY)?.[1] ?? [],
      [SYMBOL_JOB_KEY]: runsEntries.find(([jobKey]) => jobKey === SYMBOL_JOB_KEY)?.[1] ?? [],
    });
    setIsDemo(false);
  }

  useEffect(() => {
    let active = true;

    async function loadInitialState() {
      try {
        setIsLoading(true);
        setError(null);
        await loadSyncCenter();
      } catch (caught) {
        if (active) {
          console.warn("Sync API unavailable, using demo data:", caught);
          applySyncData(DEMO_STATUS, DEMO_SCHEDULE, DEMO_JOBS, DEMO_RUNS);
          setIsDemo(true);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialState();
    return () => {
      active = false;
    };
  }, []);

  async function runJob(jobKey: SyncJobKey) {
    try {
      setRunningJob(jobKey);
      setError(null);
      setNotice(null);
      setJobMessages((current) => ({ ...current, [jobKey]: undefined }));
      if (isDemo) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        setJobMessages((current) => ({ ...current, [jobKey]: "Preview sync completed successfully." }));
        return;
      }
      const result = await api.runSyncJob(jobKey);
      await loadSyncCenter();
      setJobMessages((current) => ({
        ...current,
        [jobKey]: result.status === "failed"
          ? displayMessage(result.error_message ?? result.message)
          : `${statusLabel(result.status)} run recorded for ${jobTitle(jobKey)}.`,
      }));
    } catch (caught) {
      const message =
        caught instanceof ApiError && caught.status === 501
          ? "Manual execution is not available for this sync job yet."
          : caught instanceof ApiError && caught.status === 409
            ? "Sync is already running."
            : sanitizeMessage(caught instanceof Error ? caught.message : "Unable to run sync job.");
      setJobMessages((current) => ({ ...current, [jobKey]: message }));
      if (!isDemo) {
        try {
          await loadSyncCenter();
        } catch {
          // Preserve the job-level message if the refresh also fails.
        }
      }
    } finally {
      setRunningJob(null);
    }
  }

  async function runAllJobs() {
    try {
      setIsRunningAll(true);
      for (const jobKey of SYNC_JOB_KEYS) {
        await runJob(jobKey);
      }
      setNotice("All sync jobs finished.");
    } finally {
      setIsRunningAll(false);
    }
  }

  function openScheduleSettings() {
    setScheduleTime(schedule?.daily_sync_time ?? "14:30");
    setScheduleTimezone(schedule?.timezone_name ?? DEFAULT_TIMEZONE);
    setWeekdaysOnly(schedule?.weekdays_only ?? true);
    if (schedule) {
      setJobScheduleForms(buildJobScheduleForms(jobs, schedule));
    }
    setScheduleError(null);
    setIsScheduleOpen(true);
  }

  function updateJobScheduleForm(jobKey: SyncJobKey, updates: Partial<JobScheduleForm>) {
    setJobScheduleForms((current) => ({
      ...current,
      [jobKey]: { ...current[jobKey], ...updates },
    }));
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setScheduleError(null);
    if (!validateScheduleTime(scheduleTime)) {
      setScheduleError("Please choose a valid shared time in HH:mm format.");
      return;
    }
    if (!scheduleTimezone.trim()) {
      setScheduleError("Shared schedule timezone is required.");
      return;
    }
    for (const jobKey of SYNC_JOB_KEYS) {
      const form = jobScheduleForms[jobKey];
      if (!form.useShared && !validateScheduleTime(form.time)) {
        setScheduleError(`${jobTitle(jobKey)} custom schedule needs a valid HH:mm time.`);
        return;
      }
      if (!form.useShared && !form.timezone.trim()) {
        setScheduleError(`${jobTitle(jobKey)} custom schedule timezone is required.`);
        return;
      }
    }

    try {
      setIsSavingSchedule(true);
      if (isDemo) {
        const demoUpdated = {
          ...(schedule ?? DEMO_SCHEDULE),
          daily_sync_time: scheduleTime,
          timezone_name: scheduleTimezone,
          weekdays_only: weekdaysOnly,
        };
        setSchedule(demoUpdated);
        setIsScheduleOpen(false);
        setNotice("Preview schedule saved.");
        return;
      }
      const updated = await api.updateSyncSchedule({
        daily_sync_time: scheduleTime,
        timezone_name: scheduleTimezone,
        weekdays_only: weekdaysOnly,
      });
      await Promise.all(
        SYNC_JOB_KEYS.map((jobKey) => {
          const form = jobScheduleForms[jobKey];
          return api.updateSyncJobSchedule(jobKey, {
            enabled: form.enabled,
            use_shared_schedule: form.useShared,
            daily_sync_time: form.useShared ? null : form.time,
            timezone: form.useShared ? null : form.timezone,
            weekdays_only: form.useShared ? null : form.weekdaysOnly,
          });
        }),
      );
      setSchedule(updated);
      await loadSyncCenter();
      setIsScheduleOpen(false);
      setNotice("Sync schedule saved.");
    } catch (caught) {
      setScheduleError(sanitizeMessage(caught instanceof Error ? caught.message : "Unable to save sync schedule."));
    } finally {
      setIsSavingSchedule(false);
    }
  }

  const ibkrJob = useMemo(() => jobByKey(jobs, IBKR_JOB_KEY), [jobs]);
  const symbolJob = useMemo(() => jobByKey(jobs, SYMBOL_JOB_KEY), [jobs]);
  const ibkrRuns = runsByJob[IBKR_JOB_KEY];
  const symbolRuns = runsByJob[SYMBOL_JOB_KEY];
  const ibkrRun = ibkrRuns[0] ?? null;
  const symbolRun = symbolRuns[0] ?? null;
  const latestReport: RawFlexReport | null = status?.latest_raw_flex_report ?? null;
  const symbolSuccessfulRun = latestSuccessfulRun(symbolRuns);
  const symbolArtifactPath = symbolRun?.artifact_path ?? symbolSuccessfulRun?.artifact_path ?? null;
  const latestSuccess = [latestSuccessfulRun(ibkrRuns), symbolSuccessfulRun]
    .filter((run): run is SyncRun => Boolean(run))
    .sort((a, b) => new Date(b.finished_at ?? b.started_at).getTime() - new Date(a.finished_at ?? a.started_at).getTime())[0] ?? null;
  const pipelineOperational = jobs.length > 0 && ![ibkrRun, symbolRun].some((run) => run?.status.toLowerCase() === "failed");
  const positionsImported = metadataNumber(ibkrRun, "positions_lot") ?? ibkrRun?.rows_inserted ?? null;
  const cashUpdated = metadataNumber(ibkrRun, "cash_activities") ?? ibkrRun?.rows_updated ?? null;
  const archiveName = fileName(latestReport?.xml_path);
  const runningAnything = isRunningAll || runningJob !== null || isRunning(ibkrRun) || isRunning(symbolRun);

  const activityItems = useMemo(
    () => [...ibkrRuns, ...symbolRuns]
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
      .slice(0, 5),
    [ibkrRuns, symbolRuns],
  );

  if (isLoading) {
    return (
      <div className="dashboard-state">
        <LoadingState message="Loading synchronization jobs..." />
      </div>
    );
  }

  return (
    <>
      <div className="sync-page">
        <section className="sync-hero">
          <button className="sync-edit-schedule" onClick={openScheduleSettings} type="button">
            <CalendarIcon />
            Edit Schedule
          </button>
          <div className="sync-hero-copy">
            <p className="sync-kicker">Data Pipeline</p>
            <h1>Portfolio data,<br />kept in sync.</h1>
            <p className="sync-hero-description">IBKR reports, market symbols,<br />and portfolio intelligence updates.</p>
            <div className="sync-last-update">
              <span className={`sync-live-dot${pipelineOperational ? " is-live" : ""}`} aria-hidden="true" />
              <div>
                <strong>Last successful update {formatRelativeTime(latestSuccess?.finished_at ?? latestSuccess?.started_at, isDemo)}</strong>
                <span>{formatDisplayDateTime(latestSuccess?.finished_at ?? latestSuccess?.started_at)} ({schedule?.timezone_name ?? DEFAULT_TIMEZONE})</span>
              </div>
            </div>
          </div>
          <div className="sync-hero-visual">
            <SyncPipelineIllustration />
          </div>
        </section>

        {error ? <div className="sync-alert is-error">{error}</div> : null}
        {notice ? <div className="sync-alert">{notice}</div> : null}

        <section className="sync-health-grid" aria-label="Pipeline overview">
          <article className="sync-health-card">
            <span className="sync-card-label">Pipeline Health</span>
            <div className="sync-health-value">
              <span className={`sync-health-icon${pipelineOperational ? " is-success" : ""}`}><CheckIcon /></span>
              <strong>{pipelineOperational ? "Operational" : "Needs attention"}</strong>
            </div>
            <p>{pipelineOperational ? "All data sources are healthy and up to date." : "Review the latest source status below."}</p>
          </article>
          <article className="sync-health-card">
            <span className="sync-card-label">Sources</span>
            <div className="sync-source-count"><strong>{jobs.length || 2}</strong><span><i /> Active</span></div>
            <p>IBKR Flex Reports<br />Nasdaq Symbol Directory</p>
          </article>
          <article className="sync-health-card">
            <span className="sync-card-label">Automation Schedule</span>
            <div className="sync-schedule-value"><ClockIcon /><strong>{scheduleHint(schedule)}</strong></div>
            <p>{schedule?.timezone_name ?? DEFAULT_TIMEZONE}<br />Next run {formatDisplayDateTime([ibkrJob?.next_run_at, symbolJob?.next_run_at].filter(Boolean).sort()[0] ?? null)}</p>
          </article>
        </section>

        <section className="sync-sources-section">
          <div className="sync-section-heading">
            <h2>Data Sources</h2>
            <button className="sync-run-all" disabled={runningAnything} onClick={() => void runAllJobs()} type="button">
              <RefreshIcon />
              {isRunningAll ? "Running All..." : "Run All Syncs"}
            </button>
          </div>

          <div className="sync-source-grid">
            <article className="sync-source-card">
              <div className="sync-source-header">
                <span className="sync-source-mark is-ibkr">
                  <img alt="Interactive Brokers" src="/interactive-brokers-icon.svg" />
                </span>
                <h3>IBKR Flex Reports</h3>
                <span className={`sync-connection-pill${isSuccessful(ibkrRun?.status ?? ibkrJob?.status) ? " is-connected" : ""}`}><i /> {isSuccessful(ibkrRun?.status ?? ibkrJob?.status) ? "Connected" : statusLabel(ibkrRun?.status ?? ibkrJob?.status)}</span>
              </div>
              <div className="sync-source-body">
                <div className="sync-source-last">
                  <span>Last synced</span>
                  <strong>{formatRelativeTime(ibkrRun?.finished_at ?? ibkrRun?.started_at, isDemo)}</strong>
                  <small>{formatDisplayDateTime(ibkrRun?.finished_at ?? ibkrRun?.started_at)}</small>
                </div>
                <div className="sync-source-metrics">
                  <div><strong>{formatCount(positionsImported)}</strong><span>Positions imported</span></div>
                  <div><strong>{formatCount(cashUpdated)}</strong><span>Cash records updated</span></div>
                </div>
              </div>
              {jobMessages[IBKR_JOB_KEY] ? <p className="sync-source-message">{jobMessages[IBKR_JOB_KEY]}</p> : null}
              {expandedSource === IBKR_JOB_KEY ? (
                <div className="sync-source-details">
                  <div><span>Schedule</span><strong>{jobScheduleSummary(ibkrJob, schedule)}</strong></div>
                  <div><span>Raw XML</span><code>{latestReport?.xml_path ?? "--"}</code></div>
                  <div><span>Recent message</span><strong>{displayMessage(ibkrRun?.message)}</strong></div>
                  <div><span>Recent error</span><strong>{latestErrorMessage(ibkrRun, latestReport?.error_message)}</strong></div>
                </div>
              ) : null}
              <div className="sync-source-actions">
                <button className="sync-run-source" disabled={runningAnything || !ibkrJob} onClick={() => void runJob(IBKR_JOB_KEY)} type="button"><PlayIcon />{runningJob === IBKR_JOB_KEY ? "Running..." : "Run IBKR Sync"}</button>
                <button aria-expanded={expandedSource === IBKR_JOB_KEY} className="sync-view-details" onClick={() => setExpandedSource((current) => current === IBKR_JOB_KEY ? null : IBKR_JOB_KEY)} type="button">View Details <ArrowIcon /></button>
              </div>
            </article>

            <article className="sync-source-card">
              <div className="sync-source-header">
                <span className="sync-source-mark is-nasdaq">N/</span>
                <h3>Nasdaq Directory</h3>
                <span className={`sync-connection-pill${isSuccessful(symbolRun?.status ?? symbolJob?.status) ? " is-connected" : ""}`}><i /> {isSuccessful(symbolRun?.status ?? symbolJob?.status) ? "Connected" : statusLabel(symbolRun?.status ?? symbolJob?.status)}</span>
              </div>
              <div className="sync-source-body">
                <div className="sync-source-last">
                  <span>Last synced</span>
                  <strong>{formatRelativeTime(symbolRun?.finished_at ?? symbolRun?.started_at, isDemo)}</strong>
                  <small>{formatDisplayDateTime(symbolRun?.finished_at ?? symbolRun?.started_at)}</small>
                </div>
                <div className="sync-source-metrics">
                  <div><strong>{formatCount(symbolRun?.rows_total)}</strong><span>Symbols available</span></div>
                  <div><strong>{formatCount(symbolRun?.rows_inserted)}</strong><span>New listings</span></div>
                </div>
              </div>
              {jobMessages[SYMBOL_JOB_KEY] ? <p className="sync-source-message">{jobMessages[SYMBOL_JOB_KEY]}</p> : null}
              {expandedSource === SYMBOL_JOB_KEY ? (
                <div className="sync-source-details">
                  <div><span>Schedule</span><strong>{jobScheduleSummary(symbolJob, schedule)}</strong></div>
                  <div><span>Source artifact</span><code>{symbolArtifactPath ?? "--"}</code></div>
                  <div><span>Rows updated</span><strong>{formatCount(symbolRun?.rows_updated)}</strong></div>
                  <div><span>Recent error</span><strong>{latestErrorMessage(symbolRun)}</strong></div>
                </div>
              ) : null}
              <div className="sync-source-actions">
                <button className="sync-run-source" disabled={runningAnything || !symbolJob} onClick={() => void runJob(SYMBOL_JOB_KEY)} type="button"><PlayIcon />{runningJob === SYMBOL_JOB_KEY ? "Running..." : "Run Symbol Sync"}</button>
                <button aria-expanded={expandedSource === SYMBOL_JOB_KEY} className="sync-view-details" onClick={() => setExpandedSource((current) => current === SYMBOL_JOB_KEY ? null : SYMBOL_JOB_KEY)} type="button">View Details <ArrowIcon /></button>
              </div>
            </article>
          </div>
        </section>

        <section className="sync-activity-section">
          <div className="sync-section-heading is-activity"><h2>Recent Activity</h2><span>Latest pipeline runs</span></div>
          <ol className="sync-activity-list">
            {activityItems.map((run) => {
              const successful = isSuccessful(run.status);
              const label = run.job_key === IBKR_JOB_KEY ? "IBKR Flex report synchronized" : "Nasdaq symbols refreshed";
              const detail = run.artifact_path ? fileName(run.artifact_path) : run.rows_total !== null ? `${formatCount(run.rows_total)} rows` : statusLabel(run.status);
              return (
                <li key={run.id}>
                  <time>{formatTime(run.started_at)}</time>
                  <span className={`sync-activity-status${successful ? " is-success" : ""}`}>{successful ? <CheckIcon /> : "!"}</span>
                  <strong>{label}</strong>
                  <span>{detail}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="sync-archive-section">
          <h2>Raw Data Archive</h2>
          <p>Raw XML reports are securely archived and available for recovery.</p>
          <div className="sync-archive-file">
            <span className="sync-file-icon"><FileIcon /></span>
            <strong>{archiveName}</strong>
            <span>{formatDisplayDateTime(latestReport?.downloaded_at)}</span>
            <span>{latestReport?.status ? statusLabel(latestReport.status) : "Unavailable"}</span>
          </div>
          <div className="sync-archive-actions">
            <button disabled={!latestReport?.xml_path} onClick={() => setExpandedSource(IBKR_JOB_KEY)} type="button">View Archive</button>
            <span>{latestReport?.xml_path ?? "No archive path reported"}</span>
          </div>
        </section>

        <footer className="sync-footer-note">
          <InfoIcon />
          <div><p>Data is automatically synchronized {schedule?.weekdays_only ? "every weekday" : "daily"} at {schedule?.daily_sync_time ?? "--"} {schedule?.timezone_name ?? DEFAULT_TIMEZONE}.</p><span>Need help? <strong>Review the schedule settings above.</strong></span></div>
        </footer>
      </div>

      <BaseModal
        description="Manage shared and per-job automatic sync schedules. Manual sync remains available per job."
        isOpen={isScheduleOpen}
        onClose={() => setIsScheduleOpen(false)}
        title="Sync Schedule"
      >
        <form className="modal-form sync-schedule-form" onSubmit={saveSchedule}>
          <section className="sync-schedule-section">
            <div className="sync-schedule-section-header">
              <h3>Shared Sync Schedule</h3>
              <p>Jobs using the shared schedule inherit this time, timezone, and cadence.</p>
            </div>
            <div className="sync-schedule-controls">
              <label className="filter-field">
                <span>Time</span>
                <input onChange={(event) => setScheduleTime(event.target.value)} step="60" type="time" value={scheduleTime} />
              </label>
              <label className="filter-field">
                <span>Timezone</span>
                <input onChange={(event) => setScheduleTimezone(event.target.value)} placeholder="Asia/Taipei" value={scheduleTimezone} />
              </label>
            </div>
            <label className="sync-schedule-checkbox">
              <input checked={weekdaysOnly} onChange={(event) => setWeekdaysOnly(event.target.checked)} type="checkbox" />
              <span>Weekdays only</span>
            </label>
          </section>

          <section className="sync-schedule-section">
            <div className="sync-schedule-section-header">
              <h3>Per-job schedule settings</h3>
              <p>Use the shared schedule, or set a custom schedule for an individual source.</p>
            </div>
            <div className="sync-job-schedule-list">
              {SYNC_JOB_KEYS.map((jobKey) => {
                const form = jobScheduleForms[jobKey];
                return (
                  <div className="sync-job-schedule-card" key={jobKey}>
                    <div className="sync-job-schedule-title">
                      <div><strong>{jobTitle(jobKey)}</strong><span>{form.useShared ? "Using shared schedule" : "Custom schedule"}</span></div>
                      <label className="sync-schedule-checkbox sync-schedule-inline-checkbox">
                        <input checked={form.useShared} onChange={(event) => updateJobScheduleForm(jobKey, { useShared: event.target.checked })} type="checkbox" />
                        <span>Use shared schedule</span>
                      </label>
                    </div>
                    {!form.useShared ? (
                      <div className="sync-schedule-controls sync-custom-schedule-controls">
                        <label className="filter-field"><span>Time</span><input onChange={(event) => updateJobScheduleForm(jobKey, { time: event.target.value })} step="60" type="time" value={form.time} /></label>
                        <label className="filter-field"><span>Timezone</span><input onChange={(event) => updateJobScheduleForm(jobKey, { timezone: event.target.value })} placeholder="Asia/Taipei" value={form.timezone} /></label>
                        <label className="sync-schedule-checkbox"><input checked={form.weekdaysOnly} onChange={(event) => updateJobScheduleForm(jobKey, { weekdaysOnly: event.target.checked })} type="checkbox" /><span>Weekdays only</span></label>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          {scheduleError ? <p className="form-error">{scheduleError}</p> : null}
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setIsScheduleOpen(false)} type="button">Cancel</button>
            <button className="action-button" disabled={isSavingSchedule} type="submit">{isSavingSchedule ? "Saving..." : "Save Schedule"}</button>
          </div>
        </form>
      </BaseModal>
    </>
  );
}
