// src/app/monitoring/MonitoringPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { sessionService } from "@/modules/Session/data/session.service";
import { patientService } from "@/modules/Patient/data/patient.service";
import type { Session } from "@/modules/Session/session.interface";
import type { Patient } from "@/modules/Patient/patient.interface";

import {
  isWebSerialSupported,
  getAuthorizedPorts,
  requestPort,
  openPort,
  writeLine,
  type SerialIO,
} from "./serialAdapter";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Play,
  Square,
  RefreshCw,
  Link2,
  Link2Off,
  Usb,
  User,
  Activity,
  Droplets,
  Wind,
  Check,
  AlertTriangle,
} from "lucide-react";
import type { SerialPort } from "./serial.interface";

type RealtimeRow = {
  timestamp: string;
  pulse: number; // bpm
  oxygenSaturation: number; // %
  lungCapacity: number; // valor clínico
};

function fmtTime(iso?: string) {
  return iso
    ? new Date(iso).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseLine(line: string): RealtimeRow | null {
  const ts = new Date().toISOString();
  const s = line.trim();
  if (!s) return null;

  if (s.startsWith("{") && s.endsWith("}")) {
    try {
      const obj = JSON.parse(s) as Partial<Record<string, unknown>>;
      const pulse = Number(obj.pulse ?? obj.bpm);
      const spo2 = Number(obj.spo2 ?? obj.oxygenSaturation);
      const lung = Number(obj.lung ?? obj.lungCapacity);
      if ([pulse, spo2, lung].every((x) => Number.isFinite(x))) {
        return {
          timestamp: ts,
          pulse,
          oxygenSaturation: spo2,
          lungCapacity: lung,
        };
      }
    } catch {
      return null;
    }
  } else {
    const p = s.split(/[,\s;]+/).filter(Boolean);
    if (p.length >= 3) {
      const pulse = Number(p[0]);
      const spo2 = Number(p[1]);
      const lung = Number(p[2]);
      if ([pulse, spo2, lung].every((x) => Number.isFinite(x))) {
        return {
          timestamp: ts,
          pulse,
          oxygenSaturation: spo2,
          lungCapacity: lung,
        };
      }
    }
  }
  return null;
}

export default function MonitoringPage() {
  // Estado de dominio
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState<string>("");
  const [session, setSession] = useState<Session | null>(null);

  // Serial
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [selectedPortIdx, setSelectedPortIdx] = useState<number>(-1);
  const [io, setIo] = useState<SerialIO | null>(null);

  // Flags
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [startedFromDevice, setStartedFromDevice] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Datos
  const [realtime, setRealtime] = useState<RealtimeRow[]>([]);

  // Control de envío a backend
  const lastSentRef = useRef<number>(0);
  const closeLoopRef = useRef<boolean>(false);

  // Cargar pacientes
  useEffect(() => {
    (async () => {
      try {
        const data = await patientService.findAll();
        setPatients(data ?? []);
      } catch (e: unknown) {
        const message =
          e instanceof Error
            ? e.message
            : "No se pudieron cargar los pacientes.";
        setErr(message);
      }
    })();
  }, []);

  // Cargar puertos autorizados
  useEffect(() => {
    (async () => {
      if (!isWebSerialSupported()) return;
      const list = await getAuthorizedPorts();
      setPorts(list);
    })();
  }, []);

  // Derivados UI
  const canCreateSession = !!patientId && !session;
  const canPickDevice = !!session && !isMonitoring;
  const isConnected = io !== null;
  const canConnect = !!session && selectedPortIdx >= 0 && !isConnected;
  const canStart = !!session && isConnected && !isMonitoring;
  const canStop = !!session && isMonitoring;
  const canReset = !isMonitoring && (!!session || !!patientId);

  // Acciones
  const handleCreateSession = async (): Promise<void> => {
    if (!patientId) return;
    setLoading(true);
    setErr(null);
    try {
      const s = await sessionService.create({ patientId });
      setSession(s);
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Error creando la sesión.";
      setErr(message);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestPort = async (): Promise<void> => {
    setErr(null);
    try {
      const p = await requestPort(); // puedes pasar filters si tienes VID/PID
      // Refrescar lista e índice seleccionado
      const list = await getAuthorizedPorts();
      setPorts(list);
      const idx = list.findIndex((x) => x === p);
      setSelectedPortIdx(idx >= 0 ? idx : -1);
    } catch {
      console.error("error");
    }
  };

  const handleConnect = async (): Promise<void> => {
    if (selectedPortIdx < 0) return;
    setErr(null);
    try {
      const connected = await openPort(ports[selectedPortIdx], 115200);
      setIo(connected);
      closeLoopRef.current = false;
      void readLoop(connected);
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "No se pudo abrir el puerto serial.";
      setErr(message);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    if (!io) return;
    closeLoopRef.current = true;
    try {
      await io.close();
    } catch {
      console.error("error");
    }
    setIo(null);
  };

  const handleStart = async (): Promise<void> => {
    if (!io || !session) return;
    setErr(null);
    setStartedFromDevice(false);
    await writeLine(io.writer, "1");
    setIsMonitoring(true);
  };

  const handleStop = async (): Promise<void> => {
    if (!io || !session) return;
    setErr(null);
    await writeLine(io.writer, "0");
    setIsMonitoring(false);
    try {
      await sessionService.close(session.id);
      setSession((s) => (s ? { ...s, endedAt: new Date().toISOString() } : s));
    } catch {
      console.error("error");
    }
  };

  const handleReset = async (): Promise<void> => {
    if (isMonitoring) return;
    await handleDisconnect();
    setRealtime([]);
    setStartedFromDevice(false);
    setSession(null);
    setPatientId("");
    setErr(null);
    setSelectedPortIdx(-1);
  };

  // Bucle de lectura (sin any)
  const readLoop = async (connected: SerialIO): Promise<void> => {
    while (!closeLoopRef.current) {
      try {
        const { value, done } = await connected.reader.read();
        if (done) break;
        if (!value) continue;

        const reading = parseLine(value);
        if (!reading) continue;

        if (session && !isMonitoring) {
          // Botón físico del ESP inició
          setIsMonitoring(true);
          setStartedFromDevice(true);
        }

        setRealtime((prev) => {
          const up = [...prev, reading];
          return up.slice(-200);
        });

        // Push backend 1 Hz
        const now = Date.now();
        if (session && now - lastSentRef.current >= 1000) {
          lastSentRef.current = now;
          try {
            await sessionService.addData(session.id, {
              pulse: clamp(reading.pulse, 20, 240),
              oxygenSaturation: clamp(reading.oxygenSaturation, 50, 100),
              lungCapacity: reading.lungCapacity,
            });
          } catch {
            // ruido de red aceptable
          }
        }
      } catch (e: unknown) {
        if (closeLoopRef.current) break;
        const message =
          e instanceof Error
            ? e.message
            : "Error leyendo datos del dispositivo.";
        setErr(message);
        break;
      }
    }
  };

  // UI
  const totalReads = realtime.length;

  const steps = useMemo(
    () => [
      { label: "Seleccionar paciente", done: !!patientId },
      { label: "Crear sesión", done: !!session },
      { label: "Seleccionar dispositivo", done: selectedPortIdx >= 0 },
      { label: "Conectar", done: isConnected },
      { label: "Monitorear", done: isMonitoring },
    ],
    [patientId, session, selectedPortIdx, isConnected, isMonitoring],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">Sistema de Monitoreo</h2>
          <p className="text-muted-foreground">
            Captura en tiempo real y persistencia de sesión
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={!canReset}
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Reiniciar
        </Button>
      </div>

      {err && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
            <CardDescription>{err}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Paso a paso */}
      <Card className="bg-muted/30 border-dotted">
        <CardHeader>
          <CardTitle>Flujo</CardTitle>
          <CardDescription>Secuencia operativa</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-5">
          {steps.map((s, i) => (
            <div key={i} className="rounded-lg border p-3 bg-card/50">
              <div className="flex items-center justify-between">
                <span className="text-sm">{s.label}</span>
                {s.done ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
              </div>
              <Progress value={s.done ? 100 : 0} className="h-1.5 mt-2" />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Controles */}
      <Card>
        <CardHeader>
          <CardTitle>Controles</CardTitle>
          <CardDescription>Paciente, sesión y dispositivo</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Paciente */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <select
                className="w-full rounded-md border px-3 py-2 bg-background"
                value={patientId}
                onChange={(e) => setPatientId(e.target.value)}
                disabled={!!session || loading}
              >
                <option value="">— Selecciona paciente —</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.user.fullname}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleCreateSession}
                disabled={!canCreateSession || loading}
              >
                <Usb className="h-4 w-4 mr-2" /> Crear sesión
              </Button>
            </div>
          </div>

          <Separator />

          {/* Dispositivo */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="flex items-center gap-2">
              <Usb className="h-4 w-4 text-muted-foreground" />
              <select
                className="w-full rounded-md border px-3 py-2 bg-background"
                value={selectedPortIdx}
                onChange={(e) => setSelectedPortIdx(Number(e.target.value))}
                disabled={!canPickDevice}
              >
                <option value={-1}>— Selecciona dispositivo —</option>
                {ports.map((_p, idx) => (
                  <option key={idx} value={idx}>
                    Dispositivo #{idx + 1}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              onClick={handleRequestPort}
              disabled={!canPickDevice || !isWebSerialSupported()}
            >
              Escanear / Agregar
            </Button>
            {isConnected ? (
              <Button variant="destructive" onClick={handleDisconnect}>
                <Link2Off className="h-4 w-4 mr-2" /> Desconectar
              </Button>
            ) : (
              <Button onClick={handleConnect} disabled={!canConnect}>
                <Link2 className="h-4 w-4 mr-2" /> Conectar
              </Button>
            )}
          </div>

          <Separator />

          {/* Start / Stop */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={isConnected ? "default" : "secondary"}>
                {isConnected ? "Conectado" : "Desconectado"}
              </Badge>
              {isMonitoring && startedFromDevice && (
                <Badge variant="outline">Inicio desde dispositivo</Badge>
              )}
              {session?.endedAt && (
                <Badge variant="outline">Sesión cerrada</Badge>
              )}
            </div>
            <div className="flex gap-2">
              {isMonitoring ? (
                <Button
                  variant="destructive"
                  onClick={handleStop}
                  disabled={!canStop}
                >
                  <Square className="h-4 w-4 mr-2" /> Finalizar
                </Button>
              ) : (
                <Button onClick={handleStart} disabled={!canStart}>
                  <Play className="h-4 w-4 mr-2" /> Iniciar
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Estado actual */}
      <Card className="bg-muted/30 border-dotted">
        <CardHeader>
          <CardTitle>Lecturas actuales</CardTitle>
          <CardDescription>
            Última actualización: {fmtTime(realtime.at(-1)?.timestamp)} • Total:{" "}
            {totalReads}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <MetricBox
              title="Pulso"
              value={realtime.at(-1)?.pulse}
              unit="bpm"
              icon={<Activity className="h-4 w-4" />}
            />
            <MetricBox
              title="SpO₂"
              value={realtime.at(-1)?.oxygenSaturation}
              unit="%"
              icon={<Droplets className="h-4 w-4" />}
            />
            <MetricBox
              title="Capacidad Pulmonar"
              value={realtime.at(-1)?.lungCapacity}
              unit=""
              icon={<Wind className="h-4 w-4" />}
            />
          </div>
        </CardContent>
      </Card>

      {/* Últimos 12 */}
      <Card>
        <CardHeader>
          <CardTitle>Últimos 12 registros</CardTitle>
          <CardDescription>Vista rápida</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {realtime.slice(-12).map((r, i) => (
            <div
              key={i}
              className="rounded-lg border p-3 bg-card/50 flex items-center justify-between"
            >
              <div className="text-xs text-muted-foreground">
                {fmtTime(r.timestamp)}
              </div>
              <div className="flex gap-3 text-xs">
                <Chip label="BPM" value={r.pulse} />
                <Chip label="SpO₂" value={r.oxygenSaturation} />
                <Chip label="Lung" value={r.lungCapacity} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// UI helpers sin any
function MetricBox({
  title,
  value,
  unit,
  icon,
}: {
  title: string;
  value?: number;
  unit: string;
  icon: React.ReactNode;
}) {
  const v = Number.isFinite(value) ? Number(value) : null;
  return (
    <div className="rounded-xl border p-3 bg-card/50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium">{title}</span>
        </div>
        <Badge variant="outline" className="font-mono text-[11px]">
          {v === null ? "—" : `${v.toFixed(0)}${unit}`}
        </Badge>
      </div>
      <Progress
        value={v === null ? 0 : Math.min(100, Math.max(0, v))}
        className="h-1.5"
      />
    </div>
  );
}

function Chip({ label, value }: { label: string; value: number }) {
  const v = Number.isFinite(value) ? Number(value) : null;
  return (
    <div className="flex items-center justify-between rounded-md border px-2 py-1 bg-muted/30">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="font-mono text-[12px]">
        {v === null ? "—" : v.toFixed(0)}
      </span>
    </div>
  );
}
