/**
 * WebRTC ICE Server Configuration
 * TURN-only (forced relay) — production safe for AWS
 */

const getIceServers = () => {
    const turnUrl = import.meta.env.VITE_TURN_URL
    const turnUsername = import.meta.env.VITE_TURN_USERNAME
    const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL

    // Always TURN only
    if (turnUrl && turnUsername && turnCredential) {
        console.log('✅ Using TURN from env:', turnUrl)
        return [
            {
                urls: turnUrl,
                username: turnUsername,
                credential: turnCredential
            }
        ]
    }

    console.log('✅ Using hardcoded TURN (forced relay)')
    return [
        {
            urls: [
                'turn:3.108.166.72:3478?transport=udp',
                'turn:3.108.166.72:3478?transport=tcp'
            ],
            username: 'turnuser',
            credential: 'StrongTurnPassword123'
        }
    ]
}

export const rtcConfig = {
    iceServers: getIceServers(),
    iceTransportPolicy: 'relay',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require'
}

export default rtcConfig
