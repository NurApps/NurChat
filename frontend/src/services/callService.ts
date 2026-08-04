/**
 * P2P Call Service — WebRTC audio/video calls via TCP signaling.
 *
 * Flow:
 * 1. Caller creates RTCPeerConnection, gets offer SDP
 * 2. Offer sent via TCP P2P to callee
 * 3. Callee creates RTCPeerConnection, sets remote offer, gets answer SDP
 * 4. Answer sent back via TCP P2P
 * 5. ICE candidates exchanged via TCP P2P
 * 6. WebRTC connection established → media flows directly P2P
 */

import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

// ─── Types ───

export type CallState = "idle" | "calling" | "ringing" | "connected" | "failed"

export interface CallInfo {
  callId: string
  peerUserId: string
  peerPublicKey: string
  state: CallState
  isVideo: boolean
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  startedAt: number
}

type CallEvent =
  | { type: "call_incoming"; callId: string; from: string; isVideo: boolean }
  | { type: "call_connected"; callId: string }
  | { type: "call_ended"; callId: string }
  | { type: "call_failed"; callId: string; reason: string }

type CallListener = (event: CallEvent) => void

// ─── State ───

let activeCall: CallInfo | null = null
let peerConnection: RTCPeerConnection | null = null
let localStream: MediaStream | null = null
const listeners = new Set<CallListener>()
let unlistenCall: UnlistenFn | null = null
let ringingTimeout: ReturnType<typeof setTimeout> | null = null

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
}

// ─── Listener management ───

function emitCallEvent(event: CallEvent) {
  for (const fn of listeners) {
    try { fn(event) } catch { /* ignore */ }
  }
}

export function onCallEvent(listener: CallListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// ─── Active call getters ───

export function getActiveCall(): CallInfo | null {
  return activeCall
}

export function isInCall(): boolean {
  return activeCall !== null && activeCall.state !== "idle"
}

// ─── Signaling via TCP ───

async function sendSignaling(target: string, callId: string, type: string, data: string): Promise<void> {
  await invoke("p2p_send_call_signaling", { target, callId, signalType: type, data })
}

// ─── Call lifecycle ───

/**
 * Start an outgoing call to a peer.
 */
export async function startCall(
  peerUserId: string,
  peerPublicKey: string,
  isVideo: boolean,
): Promise<void> {
  if (activeCall) {
    console.warn("[Call] Already in a call")
    return
  }

  const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2)}`

  // Get local media
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo,
    })
  } catch (err) {
    console.error("[Call] Failed to get media:", err)
    emitCallEvent({ type: "call_failed", callId, reason: "media_denied" })
    return
  }

  activeCall = {
    callId,
    peerUserId,
    peerPublicKey,
    state: "calling",
    isVideo,
    localStream,
    remoteStream: null,
    startedAt: Date.now(),
  }

  emitCallEvent({ type: "call_incoming", callId, from: "self", isVideo })

  // Create RTCPeerConnection
  peerConnection = new RTCPeerConnection(ICE_SERVERS)

  // Add local tracks
  for (const track of localStream.getTracks()) {
    peerConnection.addTrack(track, localStream)
  }

  // Handle remote stream
  peerConnection.ontrack = (event) => {
    if (activeCall) {
      activeCall.remoteStream = event.streams[0] || null
      emitCallEvent({ type: "call_connected", callId })
    }
  }

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && activeCall) {
      sendSignaling(peerPublicKey, callId, "candidate", JSON.stringify(event.candidate.toJSON())).catch(() => {})
    }
  }

  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection || !activeCall) return
    const state = peerConnection.connectionState
    if (state === "connected") {
      activeCall.state = "connected"
      activeCall.startedAt = Date.now()
      emitCallEvent({ type: "call_connected", callId })
    } else if (state === "failed" || state === "disconnected") {
      endCall()
    }
  }

  // Create and send offer
  try {
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    await sendSignaling(peerPublicKey, callId, "offer", JSON.stringify(offer))
  } catch (err) {
    console.error("[Call] Failed to create offer:", err)
    endCall()
  }
}

/**
 * Handle incoming call offer.
 */
async function handleOffer(from: string, callId: string, sdp: string, isVideo: boolean): Promise<void> {
  if (activeCall) {
    // Already in a call, reject
    await sendSignaling(from, callId, "hangup", "")
    return
  }

  // Get local media
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo,
    })
  } catch (err) {
    console.error("[Call] Failed to get media for incoming call:", err)
    await sendSignaling(from, callId, "hangup", "")
    return
  }

  activeCall = {
    callId,
    peerUserId: from,
    peerPublicKey: from,
    state: "ringing",
    isVideo,
    localStream,
    remoteStream: null,
    startedAt: Date.now(),
  }

  emitCallEvent({ type: "call_incoming", callId, from, isVideo })

  // Create RTCPeerConnection
  peerConnection = new RTCPeerConnection(ICE_SERVERS)

  for (const track of localStream.getTracks()) {
    peerConnection.addTrack(track, localStream)
  }

  peerConnection.ontrack = (event) => {
    if (activeCall) {
      activeCall.remoteStream = event.streams[0] || null
      emitCallEvent({ type: "call_connected", callId })
    }
  }

  peerConnection.onicecandidate = (event) => {
    if (event.candidate && activeCall) {
      sendSignaling(from, callId, "candidate", JSON.stringify(event.candidate.toJSON())).catch(() => {})
    }
  }

  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection || !activeCall) return
    const state = peerConnection.connectionState
    if (state === "connected") {
      activeCall.state = "connected"
      activeCall.startedAt = Date.now()
      emitCallEvent({ type: "call_connected", callId })
    } else if (state === "failed" || state === "disconnected") {
      endCall()
    }
  }

  // Set remote description and create answer
  try {
    const offerDesc = new RTCSessionDescription(JSON.parse(sdp))
    await peerConnection.setRemoteDescription(offerDesc)
    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)
    await sendSignaling(from, callId, "answer", JSON.stringify(answer))
    activeCall.state = "connected"
  } catch (err) {
    console.error("[Call] Failed to handle offer:", err)
    endCall()
  }
}

/**
 * Handle incoming call answer.
 */
function handleAnswer(callId: string, sdp: string): void {
  if (!peerConnection || !activeCall || activeCall.callId !== callId) return
  try {
    const answerDesc = new RTCSessionDescription(JSON.parse(sdp))
    peerConnection.setRemoteDescription(answerDesc)
    activeCall.state = "connected"
  } catch (err) {
    console.error("[Call] Failed to handle answer:", err)
  }
}

/**
 * Handle incoming ICE candidate.
 */
function handleCandidate(callId: string, candidateData: string): void {
  if (!peerConnection || !activeCall || activeCall.callId !== callId) return
  try {
    const candidate = new RTCIceCandidate(JSON.parse(candidateData))
    peerConnection.addIceCandidate(candidate)
  } catch (err) {
    console.error("[Call] Failed to add ICE candidate:", err)
  }
}

/**
 * Handle call hangup.
 */
function handleHangup(callId: string): void {
  if (activeCall && activeCall.callId === callId) {
    emitCallEvent({ type: "call_ended", callId })
    cleanup()
  }
}

/**
 * End the current call.
 */
export async function endCall(): Promise<void> {
  if (!activeCall) return
  const { callId, peerPublicKey } = activeCall
  try {
    await sendSignaling(peerPublicKey, callId, "hangup", "")
  } catch { /* ignore */ }
  emitCallEvent({ type: "call_ended", callId })
  cleanup()
}

/**
 * Accept an incoming call (set state from ringing → connected).
 */
export function acceptCall(): void {
  if (activeCall && activeCall.state === "ringing") {
    activeCall.state = "connected"
  }
}

/**
 * Reject an incoming call.
 */
export async function rejectCall(): Promise<void> {
  if (!activeCall) return
  const { callId, peerPublicKey } = activeCall
  try {
    await sendSignaling(peerPublicKey, callId, "hangup", "")
  } catch { /* ignore */ }
  emitCallEvent({ type: "call_ended", callId })
  cleanup()
}

/**
 * Toggle audio mute.
 */
export function toggleMute(): boolean {
  if (!localStream) return false
  const audioTrack = localStream.getAudioTracks()[0]
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled
    return audioTrack.enabled
  }
  return false
}

/**
 * Toggle video on/off.
 */
export async function toggleVideo(): Promise<boolean> {
  if (!activeCall || !peerConnection) return false
  const videoTrack = localStream?.getVideoTracks()[0]
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled
    return videoTrack.enabled
  }
  // Add video track if not present
  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({ video: true })
    const newVideoTrack = videoStream.getVideoTracks()[0]
    if (newVideoTrack) {
      peerConnection.addTrack(newVideoTrack, videoStream)
      if (localStream) localStream.addTrack(newVideoTrack)
      return true
    }
  } catch { /* ignore */ }
  return false
}

// ─── Cleanup ───

function cleanup(): void {
  if (peerConnection) {
    peerConnection.close()
    peerConnection = null
  }
  if (localStream) {
    for (const track of localStream.getTracks()) {
      track.stop()
    }
    localStream = null
  }
  if (activeCall) {
    activeCall.localStream = null
    activeCall.remoteStream = null
    activeCall = null
  }
  if (ringingTimeout) {
    clearTimeout(ringingTimeout)
    ringingTimeout = null
  }
}

// ─── Initialize TCP signaling listener ───

export function initCallSignaling(): void {
  if (unlistenCall) return

  listen("p2p-message", (event) => {
    const payload = event.payload as Record<string, unknown>
    const type = payload.type as string
    if (!type?.startsWith("p2p-call-")) return

    const from = payload.from as string
    const callId = payload.call_id as string

    if (type === "p2p-call-offer") {
      handleOffer(from, callId, payload.sdp as string, true)
    } else if (type === "p2p-call-answer") {
      handleAnswer(callId, payload.sdp as string)
    } else if (type === "p2p-call-candidate") {
      handleCandidate(callId, payload.candidate as string)
    } else if (type === "p2p-call-hangup") {
      handleHangup(callId)
    }
  }).then((unlisten) => { unlistenCall = unlisten })
}

export function destroyCallService(): void {
  if (unlistenCall) {
    unlistenCall()
    unlistenCall = null
  }
  cleanup()
}
