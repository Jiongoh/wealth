"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { BaseModal } from "@/components/BaseModal";
import { ErrorState } from "@/components/ErrorState";
import { LoadingState } from "@/components/LoadingState";
import { StatCard } from "@/components/StatCard";
import { ApiError, api, type RawFlexReport, type SyncJob, type SyncRun, type SyncSchedule, type SyncStatus } from "@/lib/api";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/format";

const IBKR_JOB_KEY = "ibkr_flex_sync";
const SYMBOL_JOB_KEY = "nasdaq_symbol_sync";
const SYNC_JOB_KEYS = [IBKR_JOB_KEY, SYMBOL_JOB_KEY] as const;

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

const DEFAULT_TIMEZONE = "Asia/Taipei";

const emptyJobScheduleForms: JobScheduleForms = {
  [IBKR_JOB_KEY]: {
    enabled: true,
    useShared: true,
    time: "08:30",
    timezone: DEFAULT_TIMEZONE,
    weekdaysOnly: false,
  },
  [SYMBOL_JOB_KEY]: {
    enabled: true,
    useShared: true,
    time: "08:30",
    timezone: DEFAULT_TIMEZONE,
    weekdaysOnly: false,
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
    return "--";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function statusClass(value: string | null | undefined): string {
  const normalized = value?.toLowerCase();
  if (normalized === "success" || normalized === "duplicate") {
    return "sync-status sync-status-success";
  }
  if (normalized === "failed") {
    return "sync-status sync-status-failed";
  }
  if (normalized === "running") {
    return "sync-status sync-status-running";
  }
  return "sync-status";
}

function statusTone(value: string | null | undefined): string {
  const normalized = value?.toLowerCase();
  if (normalized === "success" || normalized === "duplicate") {
    return "sync-status-card sync-status-card-success";
  }
  if (normalized === "failed") {
    return "sync-status-card sync-status-card-failed";
  }
  if (normalized === "running" || normalized === "pending") {
    return "sync-status-card sync-status-card-running";
  }
  return "sync-status-card sync-status-card-neutral";
}

function isRunning(run: SyncRun | null | undefined): boolean {
  return run?.status?.toLowerCase() === "running" && !run.finished_at;
}

function latestSuccessfulRun(runs: SyncRun[]): SyncRun | null {
  return runs.find((run) => run.status.toLowerCase() === "success") ?? null;
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
  return `${schedule.weekdays_only ? "Weekdays only" : "Every day"} · ${schedule.timezone_name}`;
}

function jobTitle(jobKey: SyncJobKey): string {
  return jobKey === IBKR_JOB_KEY ? "IBKR Flex Report Sync" : "Nasdaq Symbol Directory Sync";
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
    return "Using shared schedule";
  }
  const time = job.daily_sync_time ?? "--";
  const cadence = job.weekdays_only ? "Weekdays only" : "Every day";
  return `${time} · ${cadence} · ${job.timezone ?? sharedSchedule.timezone_name}`;
}

function validateScheduleTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

type SyncJobPanelProps = {
  title: string;
  description: string;
  job: SyncJob | null;
  latestRun: SyncRun | null;
  runButtonLabel: string;
  isRunningJob: boolean;
  jobNotice?: string;
  onRun: () => void;
  children: React.ReactNode;
};

function SyncJobPanel({ title, description, job, latestRun, runButtonLabel, isRunningJob, jobNotice, onRun, children }: SyncJobPanelProps) {
  const disabled = isRunningJob || isRunning(latestRun) || !job;

  return (
    <section className="panel sync-panel">
      <div className="panel-header sync-job-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button className="action-button" disabled={disabled} onClick={onRun} type="button">
          {isRunningJob || isRunning(latestRun) ? "Running..." : runButtonLabel}
        </button>
      </div>
      {!job ? <div className="sync-job-warning">This sync job is not registered by the backend yet.</div> : null}
      {jobNotice ? <div className="sync-job-notice">{jobNotice}</div> : null}
      <div className="sync-detail-grid">
        <div className="sync-detail-card">
          <span className="sync-detail-label">Recent status</span>
          <span className={statusClass(latestRun?.status ?? job?.status)}>{statusLabel(latestRun?.status ?? job?.status)}</span>
        </div>
        <div className="sync-detail-card">
          <span className="sync-detail-label">Started at</span>
          <strong>{formatDisplayDateTime(latestRun?.started_at)}</strong>
        </div>
        <div className="sync-detail-card">
          <span className="sync-detail-label">Finished at</span>
          <strong>{formatDisplayDateTime(latestRun?.finished_at)}</strong>
        </div>
        {children}
      </div>
    </section>
  );
}

export function SyncView() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [runsByJob, setRunsByJob] = useState<RunsByJob>(emptyRunsByJob);
  const [schedule, setSchedule] = useState<SyncSchedule | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [runningJob, setRunningJob] = useState<SyncJobKey | null>(null);
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [scheduleTime, setScheduleTime] = useState("08:30");
  const [scheduleTimezone, setScheduleTimezone] = useState(DEFAULT_TIMEZONE);
  const [weekdaysOnly, setWeekdaysOnly] = useState(false);
  const [jobScheduleForms, setJobScheduleForms] = useState<JobScheduleForms>(emptyJobScheduleForms);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [jobMessages, setJobMessages] = useState<JobMessages>({});

  async function loadSyncCenter() {
    const [statusData, scheduleData, jobsData] = await Promise.all([api.syncStatus(), api.syncSchedule(), api.syncJobs()]);
    const runsEntries = await Promise.all(
      SYNC_JOB_KEYS.map(async (jobKey) => [jobKey, await api.syncJobRuns(jobKey, { limit: 20 })] as const),
    );

    setStatus(statusData);
    setSchedule(scheduleData);
    setScheduleTime(scheduleData.daily_sync_time);
    setScheduleTimezone(scheduleData.timezone_name);
    setWeekdaysOnly(scheduleData.weekdays_only);
    setJobs(jobsData);
    setJobScheduleForms(buildJobScheduleForms(jobsData, scheduleData));
    setRunsByJob({
      [IBKR_JOB_KEY]: runsEntries.find(([jobKey]) => jobKey === IBKR_JOB_KEY)?.[1] ?? [],
      [SYMBOL_JOB_KEY]: runsEntries.find(([jobKey]) => jobKey === SYMBOL_JOB_KEY)?.[1] ?? [],
    });
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
          setError(sanitizeMessage(caught instanceof Error ? caught.message : "Unable to load sync jobs."));
          setStatus(null);
          setJobs([]);
          setRunsByJob(emptyRunsByJob);
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
      const result = await api.runSyncJob(jobKey);
      await loadSyncCenter();
      setJobMessages((current) => ({
        ...current,
        [jobKey]:
          result.status === "failed"
            ? displayMessage(result.error_message ?? result.message)
            : `${statusLabel(result.status)} run recorded for ${jobKey}.`,
      }));
    } catch (caught) {
      const message =
        caught instanceof ApiError && caught.status === 501
          ? "Manual execution is not available for this sync job yet."
          : caught instanceof ApiError && caught.status === 409
            ? "Sync is already running."
            : sanitizeMessage(caught instanceof Error ? caught.message : "Unable to run sync job.");
      setJobMessages((current) => ({ ...current, [jobKey]: message }));

      try {
        await loadSyncCenter();
      } catch {
        // Keep the job-level run message visible if the follow-up refresh fails.
      }
    } finally {
      setRunningJob(null);
    }
  }

  function openScheduleSettings() {
    setScheduleTime(schedule?.daily_sync_time ?? "08:30");
    setScheduleTimezone(schedule?.timezone_name ?? DEFAULT_TIMEZONE);
    setWeekdaysOnly(schedule?.weekdays_only ?? false);
    if (schedule) {
      setJobScheduleForms(buildJobScheduleForms(jobs, schedule));
    }
    setScheduleError(null);
    setIsScheduleOpen(true);
  }

  function updateJobScheduleForm(jobKey: SyncJobKey, updates: Partial<JobScheduleForm>) {
    setJobScheduleForms((current) => ({
      ...current,
      [jobKey]: {
        ...current[jobKey],
        ...updates,
      },
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
      setScheduleTime(updated.daily_sync_time);
      setScheduleTimezone(updated.timezone_name);
      setWeekdaysOnly(updated.weekdays_only);
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
  const ibkrReportDate = ibkrRun?.report_date ?? latestReport?.report_date ?? null;
  const symbolSuccessfulRun = latestSuccessfulRun(symbolRuns);
  const symbolArtifactPath = symbolRun?.artifact_path ?? symbolSuccessfulRun?.artifact_path ?? "--";

  if (isLoading) {
    return (
      <div className="dashboard-state">
        <LoadingState message="Loading synchronization jobs..." />
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">Data Import</p>
          <h1>Sync</h1>
          <p className="page-description">Manage IBKR reports, Nasdaq symbols, and data import jobs.</p>
        </div>
        <div className="sync-header-actions">
          <button className="secondary-button" onClick={openScheduleSettings} type="button">
            Sync Schedule
          </button>
        </div>
      </div>

      {error ? <ErrorState message={error} /> : null}
      {notice ? <div className="sync-notice">{notice}</div> : null}

      <section className="stat-grid sync-stat-grid" aria-label="Synchronization statistics">
        <article className={statusTone(ibkrRun?.status ?? ibkrJob?.status)}>
          <span className="stat-label">IBKR Status</span>
          <div className="sync-status-main-row">
            <span className="sync-status-icon" aria-hidden="true" />
            <strong className="sync-status-card-value">{statusLabel(ibkrRun?.status ?? ibkrJob?.status)}</strong>
          </div>
          <span className="stat-hint">Flex report sync</span>
        </article>
        <article className={statusTone(symbolRun?.status ?? symbolJob?.status)}>
          <span className="stat-label">Symbol Status</span>
          <div className="sync-status-main-row">
            <span className="sync-status-icon" aria-hidden="true" />
            <strong className="sync-status-card-value">{statusLabel(symbolRun?.status ?? symbolJob?.status)}</strong>
          </div>
          <span className="stat-hint">Nasdaq symbol directory</span>
        </article>
        <StatCard
          label="Schedule"
          value={schedule?.daily_sync_time ?? "--"}
          hint={schedule ? scheduleHint(schedule) : "--"}
        />
        <StatCard
          label="Storage / Raw Data"
          value={latestReport?.xml_path || symbolArtifactPath !== "--" ? "Available" : "--"}
          hint={latestReport?.xml_path ? "Latest Flex XML archived" : "Latest symbol CSV artifact"}
          tone="dark"
        />
      </section>

      <SyncJobPanel
        description="Manual synchronization uses the backend IBKR Flex pipeline and refreshes this module after completion."
        isRunningJob={runningJob === IBKR_JOB_KEY}
        job={ibkrJob}
        jobNotice={jobMessages[IBKR_JOB_KEY]}
        latestRun={ibkrRun}
        onRun={() => void runJob(IBKR_JOB_KEY)}
        runButtonLabel="Run IBKR Sync"
        title="IBKR Flex Report Sync Status"
      >
        <div className="sync-detail-card">
          <span className="sync-detail-label">IBKR report date</span>
          <strong>{formatDisplayDate(ibkrReportDate)}</strong>
        </div>
        <div className="sync-detail-card">
          <span className="sync-detail-label">Raw XML availability</span>
          <strong>{latestReport?.xml_path ? "Available" : "--"}</strong>
        </div>
        <div className="sync-detail-card">
          <span className="sync-detail-label">Schedule</span>
          <strong>{jobScheduleSummary(ibkrJob, schedule)}</strong>
          <p>{ibkrJob?.use_shared_schedule ? scheduleHint(schedule) : "Custom schedule"}</p>
        </div>
        <div className="sync-detail-card sync-detail-card-wide">
          <span className="sync-detail-label">Raw XML path</span>
          <code>{latestReport?.xml_path ?? "--"}</code>
        </div>
        <div className="sync-detail-card sync-detail-card-wide">
          <span className="sync-detail-label">Recent message</span>
          <p>{displayMessage(ibkrRun?.message)}</p>
        </div>
        <div className="sync-detail-card sync-detail-card-wide">
          <span className="sync-detail-label">Recent error</span>
          <p>{latestErrorMessage(ibkrRun, latestReport?.error_message)}</p>
        </div>
      </SyncJobPanel>

      <SyncJobPanel
        description="Imports the local normalized Nasdaq Symbol Directory CSV into the symbol search database."
        isRunningJob={runningJob === SYMBOL_JOB_KEY}
        job={symbolJob}
        jobNotice={jobMessages[SYMBOL_JOB_KEY]}
        latestRun={symbolRun}
        onRun={() => void runJob(SYMBOL_JOB_KEY)}
        runButtonLabel="Run Symbol Sync"
        title="Nasdaq Symbol Directory Sync Status"
      >
        <div className="sync-detail-card">
          <span className="sync-detail-label">Total symbols / rows_total</span>
          <strong>{symbolRun?.rows_total ?? "--"}</strong>
        </div>
        <div className="sync-detail-card">
          <span className="sync-detail-label">Rows inserted</span>
          <strong>{symbolRun?.rows_inserted ?? "--"}</strong>
        </div>
        <div className="sync-detail-card">
          <span className="sync-detail-label">Rows updated</span>
          <strong>{symbolRun?.rows_updated ?? "--"}</strong>
        </div>
        <div className="sync-detail-card">
          <span className="sync-detail-label">Last successful import</span>
          <strong>{formatDisplayDateTime(symbolSuccessfulRun?.finished_at ?? symbolSuccessfulRun?.started_at)}</strong>
        </div>
        <div className="sync-detail-card sync-detail-card-wide">
          <span className="sync-detail-label">Schedule</span>
          <strong>{jobScheduleSummary(symbolJob, schedule)}</strong>
          <p>{symbolJob?.use_shared_schedule ? scheduleHint(schedule) : "Custom schedule"}</p>
        </div>
        <div className="sync-detail-card sync-detail-card-wide">
          <span className="sync-detail-label">Source CSV / artifact path</span>
          <code>{symbolArtifactPath}</code>
        </div>
        <div className="sync-detail-card sync-detail-card-wide">
          <span className="sync-detail-label">Recent message</span>
          <p>{displayMessage(symbolRun?.message)}</p>
        </div>
        <div className="sync-detail-card sync-detail-card-wide">
          <span className="sync-detail-label">Recent error</span>
          <p>{latestErrorMessage(symbolRun)}</p>
        </div>
      </SyncJobPanel>

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
                <input
                  onChange={(event) => setScheduleTime(event.target.value)}
                  step="60"
                  type="time"
                  value={scheduleTime}
                />
              </label>
              <label className="filter-field">
                <span>Timezone</span>
                <input
                  onChange={(event) => setScheduleTimezone(event.target.value)}
                  placeholder="Asia/Taipei"
                  value={scheduleTimezone}
                />
              </label>
            </div>
            <label className="sync-schedule-checkbox">
              <input
                checked={weekdaysOnly}
                onChange={(event) => setWeekdaysOnly(event.target.checked)}
                type="checkbox"
              />
              <span>Weekdays only</span>
            </label>
          </section>

          <section className="sync-schedule-section">
            <div className="sync-schedule-section-header">
              <h3>Per-job schedule settings</h3>
              <p>Use shared schedule for normal operation, or set a custom schedule for an individual job.</p>
            </div>
            <div className="sync-job-schedule-list">
              {SYNC_JOB_KEYS.map((jobKey) => {
                const form = jobScheduleForms[jobKey];
                return (
                  <div className="sync-job-schedule-card" key={jobKey}>
                    <div className="sync-job-schedule-title">
                      <div>
                        <strong>{jobTitle(jobKey)}</strong>
                        <span>{form.useShared ? "Using shared schedule" : "Custom schedule"}</span>
                      </div>
                      <label className="sync-schedule-checkbox sync-schedule-inline-checkbox">
                        <input
                          checked={form.useShared}
                          onChange={(event) => updateJobScheduleForm(jobKey, { useShared: event.target.checked })}
                          type="checkbox"
                        />
                        <span>Use shared schedule</span>
                      </label>
                    </div>
                    {!form.useShared ? (
                      <div className="sync-schedule-controls sync-custom-schedule-controls">
                        <label className="filter-field">
                          <span>Time</span>
                          <input
                            onChange={(event) => updateJobScheduleForm(jobKey, { time: event.target.value })}
                            step="60"
                            type="time"
                            value={form.time}
                          />
                        </label>
                        <label className="filter-field">
                          <span>Timezone</span>
                          <input
                            onChange={(event) => updateJobScheduleForm(jobKey, { timezone: event.target.value })}
                            placeholder="Asia/Taipei"
                            value={form.timezone}
                          />
                        </label>
                        <label className="sync-schedule-checkbox">
                          <input
                            checked={form.weekdaysOnly}
                            onChange={(event) => updateJobScheduleForm(jobKey, { weekdaysOnly: event.target.checked })}
                            type="checkbox"
                          />
                          <span>Weekdays only</span>
                        </label>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          {scheduleError ? <p className="form-error">{scheduleError}</p> : null}
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setIsScheduleOpen(false)} type="button">
              Cancel
            </button>
            <button className="action-button" disabled={isSavingSchedule} type="submit">
              {isSavingSchedule ? "Saving..." : "Save Schedule"}
            </button>
          </div>
        </form>
      </BaseModal>
    </>
  );
}
