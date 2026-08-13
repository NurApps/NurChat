/**
 * Group Call Service — Mesh WebRTC for 3-8 participants.
 *
 * Architecture: Each participant creates RTCPeerConnection to every other participant.
 * No SFU needed — works with existing infrastructure.
 *
 * Flow:
 * 1. Creator calls POST /api/group-calls/start → gets call_id
 * 2. Creator connects WS to /ws/group-calls/{user_id}
 * 3. Creator sends "join" message with call_id, chat_id, call_type
 * 4. Server responds with "joined" + list of existing participants
 * 5. For each existing participant: creator creates P2P and sends offer
 * 6. Each new joiner receives "participant-joined" → creates P2P and sends offer
 * 7. When participant leaves: "participant-left" → close that peer connection
 */

import { api } from "./api"

// ─── Types ───

export type GroupCallState = "idle" | "joining" | "active" | "failed"

export interface Participant {
  userId: string
  username?: string
  isMuted: boolean
  isVideoOff: boolean
  stream: MediaStream | null
  pc: RTCPeerConnection | null
}

export interface GroupCallInfo {
  callId: string
  chatId: string
  createdBy: string
  callType: string
  state: GroupCallState
  localStream: MediaStream | null
  participants: Map<string, Participant>
}

type GroupCallEvent =
  | { type: "call_joined"; callId: string }
  | { type: "call_ended"; callId: string }
  | { type: "participant_joined"; userId: string; username?: string }
  | { type: "participant_left"; userId: string }
  | { type: "participant_muted"; userId: string; isMuted: boolean }
  | { type: "participant_video_toggle"; userId: string; isVideoOff: boolean }
  | { type: "error"; message: string }

type GroupCallListener = (event: GroupCallEvent) => void

// ─── State ───

let groupCall: GroupCallInfo | null = null
let ws: WebSocket | null = null
let localStream: MediaStream | null = null
const listeners = new Set<GroupCallListener>()

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
}

// ─── Public API ───

export function onGroupCallEvent(listener: GroupCallListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getGroupCallInfo(): GroupCallInfo | null {
  return groupCall
}

export async function startGroupCall(chatId: string, callType: "audio" | "video"): Promise<string> {
  if (groupCall?.state === "active" || groupCall?.state === "joining") {
    throw new Error("Already in a group call")
  }

  const data = await api.startGroupCall(chatId, callType)

  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: callType === "video",
  })

  groupCall = {
    callId: data.call_id,
    chatId: data.chat_id,
    createdBy: data.created_by,
    callType: data.call_type,
    state: "joining",
    localStream,
    participants: new Map(),
  }

  connectWs()

  return data.call_id
}

export async function joinGroupCall(callId: string): Promise<void> {
  if (groupCall?.state === "active" || groupCall?.state === "joining") {
    throw new Error("Already in a group call")
  }

  const data = await api.joinGroupCall(callId)

  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: data.call_type === "video",
  })

  groupCall = {
    callId: data.call_id,
    chatId: data.chat_id,
    createdBy: data.created_by,
    callType: data.call_type,
    state: "joining",
    localStream,
    participants: new Map(),
  }

  for (const p of data.participants) {
    groupCall.participants.set(p.user_id, {
      userId: p.user_id,
      username: p.username,
      isMuted: p.is_muted,
      isVideoOff: p.is_video_off,
      stream: null,
      pc: null,
    })
  }

  connectWs()
}

export async function leaveGroupCall(): Promise<void> {
  if (!groupCall) return

  try {
    await api.leaveGroupCall(groupCall.callId)
  } catch {
    // ignore
  }

  cleanup()
}

export async function endGroupCall(): Promise<void> {
  if (!groupCall) return

  try {
    await api.endGroupCall(groupCall.callId)
  } catch {
    // ignore
  }

  emit({ type: "call_ended", callId: groupCall.callId })
  cleanup()
}

export function toggleMute(): boolean {
  if (!groupCall?.localStream) return false
  const audioTrack = groupCall.localStream.getAudioTracks()[0]
  if (!audioTrack) return false

  audioTrack.enabled = !audioTrack.enabled

  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "mute", call_id: groupCall.callId, is_muted: !audioTrack.enabled }))
  }

  return !audioTrack.enabled
}

export function toggleVideo(): boolean {
  if (!groupCall?.localStream) return false
  const videoTrack = groupCall.localStream.getVideoTracks()[0]
  if (!videoTrack) return false

  videoTrack.enabled = !videoTrack.enabled

  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "video-toggle", call_id: groupCall.callId, is_video_off: !videoTrack.enabled }))
  }

  return !videoTrack.enabled
}

// ─── WebSocket Signaling ───

function connectWs() {
  if (!groupCall) return

  const user = getUserFromToken()
  if (!user) {
    emit({ type: "error", message: "No auth token" })
    return
  }

  const protocol = import.meta.env.VITE_API_PROTOCOL || "http"
  const host = import.meta.env.VITE_API_HOST || "localhost:8000"
  const wsProtocol = protocol === "https" ? "wss" : "ws"
  const token = localStorage.getItem("token") || ""

  ws = new WebSocket(`${wsProtocol}://${host}/ws/group-calls/${user.id}?token=${token}`)

  ws.onopen = () => {
    ws?.send(JSON.stringify({
      type: "join",
      call_id: groupCall!.callId,
      chat_id: groupCall!.chatId,
      call_type: groupCall!.callType,
      username: user.username || user.id,
    }))
  }

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data)
    await handleSignalingMessage(data)
  }

  ws.onclose = () => {
    if (groupCall?.state === "active" || groupCall?.state === "joining") {
      cleanup()
      emit({ type: "call_ended", callId: groupCall?.callId || "" })
    }
  }

  ws.onerror = () => {
    if (groupCall) {
      groupCall.state = "failed"
      emit({ type: "error", message: "WebSocket error" })
    }
  }
}

async function handleSignalingMessage(data: Record<string, unknown>) {
  if (!groupCall) return

  switch (data.type) {
    case "joined": {
      const participants = (data.participants as Array<{ user_id: string; username?: string }>) || []
      groupCall.state = "active"
      emit({ type: "call_joined", callId: groupCall.callId })

      for (const p of participants) {
        await createPeerConnection(p.user_id, true)
      }
      break
    }

    case "participant-joined": {
      const userId = data.user_id as string
      const username = data.username as string | undefined
      if (!groupCall.participants.has(userId)) {
        groupCall.participants.set(userId, {
          userId,
          username,
          isMuted: false,
          isVideoOff: false,
          stream: null,
          pc: null,
        })
      }
      emit({ type: "participant_joined", userId, username })
      break
    }

    case "participant-left": {
      const userId = data.user_id as string
      const p = groupCall.participants.get(userId)
      if (p?.pc) {
        p.pc.close()
      }
      groupCall.participants.delete(userId)
      emit({ type: "participant_left", userId })
      break
    }

    case "offer": {
      const from = data.from as string
      await handleOffer(from, data as unknown as RTCSessionDescriptionInit)
      break
    }

    case "answer": {
      const from = data.from as string
      await handleAnswer(from, data as unknown as RTCSessionDescriptionInit)
      break
    }

    case "ice-candidate": {
      const from = data.from as string
      await handleIceCandidate(from, data as unknown as RTCIceCandidateInit)
      break
    }

    case "participant-muted": {
      const userId = data.user_id as string
      const isMuted = data.is_muted as boolean
      const p = groupCall.participants.get(userId)
      if (p) p.isMuted = isMuted
      emit({ type: "participant_muted", userId, isMuted })
      break
    }

    case "participant-video-toggle": {
      const userId = data.user_id as string
      const isVideoOff = data.is_video_off as boolean
      const p = groupCall.participants.get(userId)
      if (p) p.isVideoOff = isVideoOff
      emit({ type: "participant_video_toggle", userId, isVideoOff })
      break
    }
  }
}

// ─── WebRTC Mesh ───

async function createPeerConnection(remoteUserId: string, initiator: boolean) {
  if (!groupCall?.localStream) return

  const pc = new RTCPeerConnection(ICE_SERVERS)

  const participant = groupCall.participants.get(remoteUserId) || {
    userId: remoteUserId,
    isMuted: false,
    isVideoOff: false,
    stream: null,
    pc: null,
  }
  participant.pc = pc
  groupCall.participants.set(remoteUserId, participant)

  for (const track of groupCall.localStream.getTracks()) {
    pc.addTrack(track, groupCall.localStream)
  }

  const remoteStream = new MediaStream()
  participant.stream = remoteStream

  pc.ontrack = (event) => {
    for (const track of event.streams[0].getTracks()) {
      remoteStream.addTrack(track)
    }
  }

  pc.onicecandidate = (event) => {
    if (event.candidate && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "ice-candidate",
        call_id: groupCall!.callId,
        to: remoteUserId,
        candidate: event.candidate.toJSON(),
      }))
    }
  }

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      const p = groupCall?.participants.get(remoteUserId)
      if (p) {
        p.stream = null
        p.pc = null
      }
    }
  }

  if (initiator) {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "offer",
        call_id: groupCall!.callId,
        to: remoteUserId,
        sdp: pc.localDescription?.toJSON(),
      }))
    }
  }
}

async function handleOffer(fromUserId: string, offer: RTCSessionDescriptionInit) {
  if (!groupCall) return

  let participant = groupCall.participants.get(fromUserId)
  if (!participant) {
    participant = {
      userId: fromUserId,
      isMuted: false,
      isVideoOff: false,
      stream: null,
      pc: null,
    }
    groupCall.participants.set(fromUserId, participant)
  }

  if (!participant.pc) {
    await createPeerConnection(fromUserId, false)
    participant = groupCall.participants.get(fromUserId)!
  }

  const pc = participant.pc!
  await pc.setRemoteDescription(new RTCSessionDescription(offer))
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)

  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "answer",
      call_id: groupCall.callId,
      to: fromUserId,
      sdp: pc.localDescription?.toJSON(),
    }))
  }
}

async function handleAnswer(fromUserId: string, answer: RTCSessionDescriptionInit) {
  if (!groupCall) return
  const participant = groupCall.participants.get(fromUserId)
  if (!participant?.pc) return

  await participant.pc.setRemoteDescription(new RTCSessionDescription(answer))
}

async function handleIceCandidate(fromUserId: string, candidate: RTCIceCandidateInit) {
  if (!groupCall) return
  const participant = groupCall.participants.get(fromUserId)
  if (!participant?.pc) return

  await participant.pc.addIceCandidate(new RTCIceCandidate(candidate))
}

// ─── Helpers ───

function cleanup() {
  if (ws) {
    ws.close()
    ws = null
  }

  if (groupCall) {
    for (const [, p] of groupCall.participants) {
      p.pc?.close()
    }
    groupCall.participants.clear()
  }

  if (localStream) {
    for (const track of localStream.getTracks()) {
      track.stop()
    }
    localStream = null
  }

  if (groupCall) {
    groupCall.state = "idle"
    groupCall.localStream = null
  }
  groupCall = null
}

function emit(event: GroupCallEvent) {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // ignore
    }
  }
}

function getUserFromToken(): { id: string; username?: string } | null {
  try {
    const token = localStorage.getItem("token")
    if (!token) return null
    const payload = JSON.parse(atob(token.split(".")[1]))
    return { id: payload.sub, username: payload.username }
  } catch {
    return null
  }
}
