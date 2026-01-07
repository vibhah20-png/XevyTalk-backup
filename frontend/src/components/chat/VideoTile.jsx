
import React, { useEffect, useRef } from 'react'

export default function VideoTile({ stream, muted }) {
    const ref = useRef(null)
    useEffect(() => {
        if (ref.current) {
            ref.current.srcObject = stream || null
            // Ensure audio is enabled and volume is set
            if (!muted && ref.current) {
                ref.current.volume = 1.0
                ref.current.muted = false
            }
        }
    }, [stream, muted])
    return (
        <video
            ref={ref}
            autoPlay
            playsInline
            muted={muted}
            className="w-full h-full object-cover rounded-xl bg-black"
        />
    )
}
