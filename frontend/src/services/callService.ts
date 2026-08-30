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

function isTauri(): boolean {
  try {
    return !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  } catch {
    return false
  }
}

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
let unlistenCall: (() => void) | null = null
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
  if (!isTauri()) throw new Error("P2P call signaling not available in browser mode")
  const { invoke } = await import("@tauri-apps/api/core")
  // Timeout: if P2P send hangs, don't block the app forever
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Signaling timeout")), 8000)
  )
  await Promise.race([
    invoke("p2p_send_call_signaling", { target, callId, signalType: type, data }),
    timeout,
  ])
}

/** Fire-and-forget signaling — used for hangup so cleanup runs immediately. */
function sendSignalingNoWait(target: string, callId: string, type: string, data: string): void {
  sendSignaling(target, callId, type, data).catch(() => {})
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

  // Ring timeout: don't ring forever if the callee never answers
  if (ringingTimeout) clearTimeout(ringingTimeout)
  ringingTimeout = setTimeout(() => {
    if (activeCall && activeCall.state === "calling") {
      console.log("[Call] Ring timeout, no answer")
      endCall()
    }
  }, 45000)

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
      if (ringingTimeout) { clearTimeout(ringingTimeout); ringingTimeout = null }
      emitCallEvent({ type: "call_connected", callId })
    }
  }

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && activeCall) {
      sendSignalingNoWait(peerPublicKey, callId, "candidate", JSON.stringify(event.candidate.toJSON()))
    }
  }

  let disconnectGrace: ReturnType<typeof setTimeout> | null = null
  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection || !activeCall) return
    const state = peerConnection.connectionState
    if (state === "connected") {
      activeCall.state = "connected"
      activeCall.startedAt = Date.now()
      if (disconnectGrace) { clearTimeout(disconnectGrace); disconnectGrace = null }
      if (ringingTimeout) { clearTimeout(ringingTimeout); ringingTimeout = null }
      emitCallEvent({ type: "call_connected", callId })
    } else if (state === "disconnected") {
      // Transient per spec — give ICE a grace period to self-recover
      if (!disconnectGrace) {
        disconnectGrace = setTimeout(() => {
          disconnectGrace = null
          if (peerConnection?.connectionState !== "connected") endCall()
        }, 8000)
      }
    } else if (state === "failed") {
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
 * IMPORTANT: do NOT capture media or answer here — the callee must
 * explicitly accept first. We only store the offer and notify the UI.
 */
let pendingOffer: { from: string; callId: string; sdp: string; isVideo: boolean } | null = null

async function handleOffer(from: string, callId: string, sdp: string, isVideo: boolean): Promise<void> {
  if (activeCall) {
    // Already in a call, reject
    await sendSignaling(from, callId, "hangup", "")
    return
  }

  pendingOffer = { from, callId, sdp, isVideo }

  activeCall = {
    callId,
    peerUserId: from,
    peerPublicKey: from,
    state: "ringing",
    isVideo,
    localStream: null,
    remoteStream: null,
    startedAt: Date.now(),
  }

  emitCallEvent({ type: "call_incoming", callId, from, isVideo })

  // Auto-reject unanswered incoming calls after 45s
  if (ringingTimeout) clearTimeout(ringingTimeout)
  ringingTimeout = setTimeout(() => {
    if (activeCall && activeCall.state === "ringing") {
      void rejectCall()
    }
  }, 45000)
}

/**
 * Handle incoming call answer.
 */
async function handleAnswer(callId: string, sdp: string): Promise<void> {
  if (!peerConnection || !activeCall || activeCall.callId !== callId) return
  // Guard against duplicate/mis-ordered answers
  if (peerConnection.signalingState !== "have-local-offer") {
    console.warn("[Call] Ignoring answer in state", peerConnection.signalingState)
    return
  }
  try {
    const answerDesc = new RTCSessionDescription(JSON.parse(sdp))
    await peerConnection.setRemoteDescription(answerDesc)
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
  // Fire-and-forget: don't wait for signaling — cleanup immediately
  sendSignalingNoWait(peerPublicKey, callId, "hangup", "")
  emitCallEvent({ type: "call_ended", callId })
  cleanup()
}

/**
 * Accept an incoming call: capture media, build the peer connection,
 * and answer the pending offer. Media is captured ONLY here, after
 * explicit user consent.
 */
export async function acceptCall(): Promise<void> {
  if (!activeCall || activeCall.state !== "ringing" || !pendingOffer) return
  const { from, callId, sdp, isVideo } = pendingOffer
  pendingOffer = null
  if (ringingTimeout) { clearTimeout(ringingTimeout); ringingTimeout = null }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideo,
    })
  } catch (err) {
    console.error("[Call] Failed to get media for incoming call:", err)
    activeCall.localStream = null
    await rejectCall()
    return
  }
  activeCall.localStream = localStream

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
      sendSignalingNoWait(from, callId, "candidate", JSON.stringify(event.candidate.toJSON()))
    }
  }

  let disconnectGrace: ReturnType<typeof setTimeout> | null = null
  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection || !activeCall) return
    const state = peerConnection.connectionState
    if (state === "connected") {
      activeCall.state = "connected"
      activeCall.startedAt = Date.now()
      if (disconnectGrace) { clearTimeout(disconnectGrace); disconnectGrace = null }
      emitCallEvent({ type: "call_connected", callId })
    } else if (state === "disconnected") {
      // Transient — allow ICE to self-recover before tearing down
      if (!disconnectGrace) {
        disconnectGrace = setTimeout(() => {
          disconnectGrace = null
          if (peerConnection?.connectionState !== "connected") endCall()
        }, 8000)
      }
    } else if (state === "failed") {
      endCall()
    }
  }

  try {
    const offerDesc = new RTCSessionDescription(JSON.parse(sdp))
    await peerConnection.setRemoteDescription(offerDesc)
    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)
    await sendSignaling(from, callId, "answer", JSON.stringify(answer))
  } catch (err) {
    console.error("[Call] Failed to answer offer:", err)
    endCall()
  }
}

/**
 * Reject an incoming call.
 */
export async function rejectCall(): Promise<void> {
  if (!activeCall) return
  const { callId, peerPublicKey } = activeCall
  pendingOffer = null
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
  // Add video track if not present (requires renegotiation)
  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({ video: true })
    const newVideoTrack = videoStream.getVideoTracks()[0]
    if (newVideoTrack && activeCall) {
      peerConnection.addTrack(newVideoTrack, videoStream)
      if (localStream) localStream.addTrack(newVideoTrack)
      // addTrack() needs a fresh offer — renegotiate with the peer
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      await sendSignaling(activeCall.peerPublicKey, activeCall.callId, "offer", JSON.stringify(offer))
      return true
    }
  } catch { /* ignore */ }
  return false
}

// ─── Cleanup ───

function cleanup(): void {
  pendingOffer = null
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
  if (!isTauri()) return

  import("@tauri-apps/api/event").then(({ listen }) => {
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
  }).catch(() => {})
}

export function destroyCallService(): void {
  if (unlistenCall) {
    unlistenCall()
    unlistenCall = null
  }
  cleanup()
}
