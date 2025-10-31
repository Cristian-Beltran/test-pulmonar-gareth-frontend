// src/app/dashboard/DashboardPage.tsx
import { useEffect, useMemo, useState } from "react";
import {
  Users,
  Activity,
  AlertTriangle,
  CheckCircle,
  Heart,
  Droplets,
  Wind,
  RefreshCw,
} from "lucide-react";
import { useAuthStore } from "@/auth/useAuth";
import { sessionService } from "@/modules/Session/data/session.service";
import type { Session, SessionData } from "@/modules/Session/session.interface";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";

// === helpers (adaptados al modelo actual) ===
function formatRelative(dateISO?: string) {
  if (!dateISO) return "Sin lecturas";
  const diffMs = Date.now() - new Date(dateISO).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Hace segundos";
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `Hace ${days} d`;
}

function latestRecordOfSession(s: Session): SessionData | undefined {
  return (s.records ?? []).reduce<SessionData | undefined>(
    (acc, r) =>
      !acc || new Date(r.recordedAt) > new Date(acc.recordedAt) ? r : acc,
    undefined,
  );
}

function latestGlobal(sessions: Session[]) {
  let rec: SessionData | undefined;
  let ses: Session | undefined;
  for (const s of sessions) {
    for (const r of s.records ?? []) {
      if (!rec || new Date(r.recordedAt) > new Date(rec.recordedAt)) {
        rec = r;
        ses = s;
      }
    }
  }
  return { rec, ses };
}

function countTodaySessions(sessions: Session[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return sessions.filter((s) => {
    const d = new Date(s.startedAt);
    return d >= start && d <= end;
  }).length;
}

function distinctPatientCount(sessions: Session[]) {
  const set = new Set<string>();
  sessions.forEach((s) => s.patient?.id && set.add(s.patient.id));
  return set.size;
}

function safeNum(n: unknown) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function pct(now: number | null, min: number, max: number) {
  if (now == null || max <= min) return 0;
  return Math.max(0, Math.min(100, ((now - min) / (max - min)) * 100));
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await sessionService.findAll(); // ✅ solo getAll
      setSessions(data ?? []);
    } catch (e) {
      console.error(e);
      setError("No se pudieron cargar las sesiones.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Derivados
  const { rec: latestRecord, ses: latestSession } = useMemo(
    () => latestGlobal(sessions),
    [sessions],
  );

  const lastUpdate = useMemo(
    () => formatRelative(latestRecord?.recordedAt),
    [latestRecord],
  );

  const latestPatientName = latestSession?.patient
    ? `${latestSession.patient.firstName ?? ""} ${latestSession.patient.lastName ?? ""}`.trim() ||
      latestSession.patient.id
    : "Paciente";

  const patientsCount = useMemo(
    () => distinctPatientCount(sessions),
    [sessions],
  );
  const todayCount = useMemo(() => countTodaySessions(sessions), [sessions]);
  const criticalCount = 0; // Hookéalo a reglas si corresponde
  const stableCount = Math.max(patientsCount - criticalCount, 0);

  // Recientes (top 5 por última lectura)
  const recentPatients = useMemo(() => {
    const map = new Map<string, { name: string; lastISO: string }>();
    sessions.forEach((s) => {
      const r = latestRecordOfSession(s);
      if (!r || !s.patient?.id) return;
      const name = s.patient.firstName
        ? `${s.patient.firstName} ${s.patient.lastName ?? ""}`.trim()
        : s.patient.id;
      const cur = map.get(s.patient.id);
      if (!cur || new Date(r.recordedAt) > new Date(cur.lastISO)) {
        map.set(s.patient.id, { name, lastISO: r.recordedAt });
      }
    });
    return Array.from(map.values())
      .sort(
        (a, b) => new Date(b.lastISO).getTime() - new Date(a.lastISO).getTime(),
      )
      .slice(0, 5)
      .map((p) => ({ name: p.name, last: formatRelative(p.lastISO) }));
  }, [sessions]);

  // KPIs compactos
  const kpis = [
    {
      label: "Pacientes",
      value: patientsCount,
      icon: Users,
      variant: "outline" as const,
    },
    {
      label: "Sesiones hoy",
      value: todayCount,
      icon: Activity,
      variant: "secondary" as const,
    },
    {
      label: "Críticas",
      value: criticalCount,
      icon: AlertTriangle,
      variant: "destructive" as const,
    },
    {
      label: "Estables",
      value: stableCount,
      icon: CheckCircle,
      variant: "outline" as const,
    },
  ];

  // Vitals del último registro (modelo actual)
  const vPulse = safeNum(latestRecord?.pulse);
  const vSpo2 = safeNum(latestRecord?.oxygenSaturation);
  const vLung = safeNum(latestRecord?.lungCapacity);

  // Rango simple para barras de progreso (ajusta si defines rangos clínicos)
  const rPulse = { min: 40, max: 160 };
  const rSpo2 = { min: 85, max: 100 };
  const rLung = { min: 0, max: Math.max(5, (vLung ?? 0) * 1.4) };

  return (
    <div className="space-y-6">
      {/* Encabezado con acción */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">
            Hola, {user?.fullname ?? "Doctor"}
          </h2>
          <p className="text-muted-foreground">
            Panel consolidado de monitoreo
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          disabled={loading}
          title="Recargar"
        >
          <RefreshCw className="h-4 w-4 mr-2" />{" "}
          {loading ? "Cargando..." : "Recargar"}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* KPIs (nuevo look: tarjetas punteadas y fondos muted) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="bg-muted/30 border-dotted">
            <CardContent className="py-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-muted-foreground">
                  {k.label}
                </div>
                <div className="text-xl font-semibold">{k.value}</div>
              </div>
              <Badge variant={k.variant} className="gap-1">
                <k.icon className="h-4 w-4" />
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Contenido principal en dos columnas */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Última lectura global (card de vitals distinta) */}
        <Card className="bg-card/60 backdrop-blur border-dotted">
          <CardHeader>
            <CardTitle>Última Lectura</CardTitle>
            <CardDescription>
              {latestSession ? (
                <>
                  Paciente:{" "}
                  <span className="font-medium">{latestPatientName}</span> •{" "}
                  {lastUpdate}
                </>
              ) : (
                "Aún no hay lecturas registradas"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <VitalTile
                title="Pulso"
                value={vPulse}
                unit="bpm"
                icon={<Heart className="h-4 w-4" />}
                progress={pct(vPulse, rPulse.min, rPulse.max)}
                hint={`${rPulse.min}-${rPulse.max}`}
              />
              <VitalTile
                title="SpO₂"
                value={vSpo2}
                unit="%"
                icon={<Droplets className="h-4 w-4" />}
                progress={pct(vSpo2, rSpo2.min, rSpo2.max)}
                hint={`${rSpo2.min}-${rSpo2.max}`}
              />
              <VitalTile
                title="Cap. Pulmonar"
                value={vLung}
                unit=""
                icon={<Wind className="h-4 w-4" />}
                progress={pct(vLung, rLung.min, rLung.max)}
                hint={`${rLung.min}-${rLung.max.toFixed(1)}`}
              />
            </div>

            <Separator />

            <div className="text-xs text-muted-foreground">
              {latestSession ? (
                <>
                  Sesión {latestSession.id.slice(0, 8)}… iniciada{" "}
                  {new Date(latestSession.startedAt).toLocaleString("es-ES")}
                </>
              ) : (
                <>No hay sesión activa</>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pacientes recientes (lista nueva) */}
        <Card>
          <CardHeader>
            <CardTitle>Pacientes Recientes</CardTitle>
            <CardDescription>Top 5 por última lectura</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentPatients.length ? (
              recentPatients.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border p-3 bg-muted/30"
                >
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.last}
                    </div>
                  </div>
                  <Badge variant="secondary">Estable</Badge>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">
                Aún no hay lecturas para mostrar.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sesiones recientes (resumen comprimido) */}
      <Card>
        <CardHeader>
          <CardTitle>Sesiones Recientes</CardTitle>
          <CardDescription>
            Resumen compacto de las últimas 6 sesiones
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {sessions
            .slice()
            .sort(
              (a, b) =>
                new Date(b.startedAt).getTime() -
                new Date(a.startedAt).getTime(),
            )
            .slice(0, 6)
            .map((s) => {
              const r = latestRecordOfSession(s);
              const name = s.patient?.firstName
                ? `${s.patient.firstName} ${s.patient.lastName ?? ""}`.trim()
                : (s.patient?.id ?? "Paciente");
              return (
                <Card key={s.id} className="border-muted/70">
                  <CardContent className="py-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{name}</div>
                      <Badge variant={s.endedAt ? "outline" : "default"}>
                        {s.endedAt ? "Cerrada" : "Activa"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.startedAt).toLocaleString("es-ES")}
                    </div>
                    <Separator />
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <Chip label="BPM" value={safeNum(r?.pulse)} />
                      <Chip label="SpO₂" value={safeNum(r?.oxygenSaturation)} />
                      <Chip label="Lung" value={safeNum(r?.lungCapacity)} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}

// === UI auxiliares locales (estética distinta) ===
function VitalTile({
  title,
  value,
  unit,
  icon,
  progress,
  hint,
}: {
  title: string;
  value: number | null;
  unit: string;
  icon: React.ReactNode;
  progress: number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border p-3 bg-card/50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{title}</span>
        </div>
        <Badge variant="outline" className="font-mono text-[11px]">
          {value == null ? "—" : `${value.toFixed(0)}${unit}`}
        </Badge>
      </div>
      <Progress value={progress} className="h-1.5" />
      {hint && (
        <div className="text-[11px] text-muted-foreground mt-2">
          Rango: {hint}
        </div>
      )}
    </div>
  );
}

function Chip({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center justify-between rounded-md border px-2 py-1 bg-muted/30">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[12px]">
        {value == null ? "—" : value.toFixed(0)}
      </span>
    </div>
  );
}
