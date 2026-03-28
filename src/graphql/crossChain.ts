import type { PrismaClient } from "@prisma/client";

interface CrossChainDispatchRecord {
  id: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  timestamp: Date | string;
  messageType: string;
  sourceChain: string;
  destChain: string;
  sender: string;
  data: string;
  commitment: string | null;
  status: string;
}

export interface CrossChainPipeline {
  intentId: string;
  txHash: string;
  commitment: string | null;
  sender: string;
  sourceChain: string;
  destChain: string;
  latestStatus: string;
  latestMessageType: string;
  lastUpdatedAt: string;
  steps: CrossChainDispatchRecord[];
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function compareSteps(a: CrossChainDispatchRecord, b: CrossChainDispatchRecord) {
  const tsDiff =
    new Date(toIsoString(a.timestamp)).getTime() -
    new Date(toIsoString(b.timestamp)).getTime();
  if (tsDiff !== 0) return tsDiff;
  if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
  return a.logIndex - b.logIndex;
}

function pipelineKey(record: CrossChainDispatchRecord): string {
  return normalizeIdentifier(record.commitment) || normalizeIdentifier(record.txHash);
}

function uniqueSteps(records: CrossChainDispatchRecord[]): CrossChainDispatchRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = `${normalizeIdentifier(record.txHash)}:${record.logIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildCrossChainPipeline(
  intentId: string,
  records: CrossChainDispatchRecord[],
): CrossChainPipeline | null {
  if (records.length === 0) return null;

  const steps = uniqueSteps(records).sort(compareSteps);
  const origin = steps[0];
  const latest = steps[steps.length - 1];

  return {
    intentId: normalizeIdentifier(intentId) || pipelineKey(origin),
    txHash: origin.txHash,
    commitment: steps.find((step) => !!step.commitment)?.commitment ?? null,
    sender: origin.sender,
    sourceChain: origin.sourceChain,
    destChain: origin.destChain,
    latestStatus: latest.status,
    latestMessageType: latest.messageType,
    lastUpdatedAt: toIsoString(latest.timestamp),
    steps: steps.map((step) => ({
      ...step,
      timestamp: toIsoString(step.timestamp),
    })),
  };
}

export async function resolveCrossChainPipeline(
  prisma: PrismaClient,
  intentId: string,
): Promise<CrossChainPipeline | null> {
  const normalizedIntentId = normalizeIdentifier(intentId);
  if (!normalizedIntentId) return null;

  const anchors = await prisma.crossChainDispatch.findMany({
    where: {
      OR: [{ txHash: intentId }, { commitment: intentId }],
    },
    orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
  });

  if (anchors.length === 0) return null;

  const anchor = anchors[0];
  const commitment = anchors.find((item) => item.commitment)?.commitment ?? null;
  const related = commitment
    ? await prisma.crossChainDispatch.findMany({
        where: {
          OR: [{ commitment }, { txHash: anchor.txHash }],
        },
        orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }],
      })
    : anchors;

  return buildCrossChainPipeline(intentId, related);
}

export async function listCrossChainPipelines(
  prisma: PrismaClient,
  args: {
    limit?: number;
    sender?: string;
    status?: string;
  },
): Promise<CrossChainPipeline[]> {
  const take = Math.min(Math.max((args.limit ?? 10) * 8, 50), 500);
  const records = await prisma.crossChainDispatch.findMany({
    where: args.sender
      ? { sender: { equals: args.sender, mode: "insensitive" } }
      : undefined,
    orderBy: [{ blockNumber: "desc" }, { logIndex: "desc" }],
    take,
  });

  const grouped = new Map<string, CrossChainDispatchRecord[]>();
  for (const record of records) {
    const key = pipelineKey(record);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(record);
    } else {
      grouped.set(key, [record]);
    }
  }

  const pipelines = [...grouped.entries()]
    .map(([key, bucket]) => buildCrossChainPipeline(key, bucket))
    .filter((pipeline): pipeline is CrossChainPipeline => pipeline !== null)
    .filter((pipeline) =>
      args.status ? pipeline.latestStatus === args.status : true,
    )
    .sort(
      (a, b) =>
        new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime(),
    )
    .slice(0, args.limit ?? 10);

  return pipelines;
}
