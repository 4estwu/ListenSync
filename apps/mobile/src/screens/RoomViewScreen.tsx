import { useCallback, useEffect, useState } from 'react'
import { ScrollView, Text, TextInput, TouchableOpacity, View, type LayoutChangeEvent, type GestureResponderEvent } from 'react-native'
import type { Track } from '@spotifyapple/shared'
import { useSession } from '../context/SessionContext'
import { useRoomSync } from '../sync/useRoomSync'
import type { AdapterTrackResult, PlaybackAdapter } from '../platform/adapter'
import { styles } from './styles'

const SEEK_STEP_MS = 15_000

// Satisfies useRoomSync's required (non-nullable) adapter prop for the brief
// window before SessionContext has a real one — every method rejects
// immediately rather than hanging, so useRoomSync's existing error handling
// (it already catches and logs adapter failures) takes care of it with no
// special-casing needed here.
const NOOP_ADAPTER: PlaybackAdapter = {
  platform: 'spotify',
  getState: async () => null,
  play: async () => {
    throw new Error('No adapter yet')
  },
  pause: async () => {
    throw new Error('No adapter yet')
  },
  seek: async () => {
    throw new Error('No adapter yet')
  },
  search: async () => [],
  resolveByIsrc: async () => null,
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function toSharedTrack(adapter: PlaybackAdapter, result: AdapterTrackResult): Track {
  return {
    title: result.title,
    artist: result.artist,
    durationMs: result.durationMs,
    isrc: result.isrc,
    platformIds: { [adapter.platform]: result.platformId },
  }
}

/**
 * Mobile port of apps/web/src/RoomView.tsx, reached only via the native
 * Spotify path (Apple Music instead goes through AppleMusicWebViewScreen,
 * which never routes here). UI-only differences from the web version are
 * React Native's component set (View/Text/TouchableOpacity instead of
 * div/span/button) and the progress bar's seek gesture (onLayout +
 * locationX instead of a click handler + getBoundingClientRect). The actual
 * sync logic underneath (useRoomSync) is the same ported hook — this screen
 * will behave identically to the web room view once the adapter in
 * platform/spotifyAdapter.ts is wired to real native SDK calls; right now
 * every action will surface the adapter's "not yet implemented" errors in
 * the log below, which is expected.
 */
export function RoomViewScreen() {
  const { roomId, adapter } = useSession()
  const [log, setLog] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<AdapterTrackResult[]>([])
  const [barWidth, setBarWidth] = useState(0)
  const [, forceTick] = useState(0)

  const say = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 30))
  }, [])

  // roomId/adapter are only null before the Connect/RoomChooser steps have
  // run — the navigator only routes here afterward, so this screen can rely
  // on both being set. Deliberately NOT an early return before the hooks
  // below: conditionally skipping a hook call based on this would violate
  // the Rules of Hooks (every render must call the same hooks in the same
  // order) the moment roomId/adapter go from null to set.
  const activeRoomId = roomId ?? ''
  const activeAdapter = adapter ?? NOOP_ADAPTER

  const { roomState, deviceError, addToQueue, removeFromQueue, gotoIndex, skipNext, pause, resume, seekTo } = useRoomSync({
    roomId: activeRoomId,
    adapter: activeAdapter,
    onLog: say,
  })

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }
    const handle = setTimeout(async () => {
      try {
        setSearchResults(await activeAdapter.search(searchQuery))
      } catch (err) {
        say(`Search error: ${(err as Error).message}`)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [searchQuery, activeAdapter, say])

  useEffect(() => {
    if (!roomState?.isPlaying) return
    const handle = setInterval(() => forceTick((t) => t + 1), 250)
    return () => clearInterval(handle)
  }, [roomState?.isPlaying])

  const current = roomState && roomState.currentIndex >= 0 ? roomState.queue[roomState.currentIndex] : null

  const displayedPositionMs =
    current && roomState
      ? Math.min(
          current.track.durationMs,
          roomState.isPlaying ? roomState.positionMs + (Date.now() - roomState.updatedAt) : roomState.positionMs,
        )
      : 0

  const seekBy = (deltaMs: number) => {
    if (!current) return
    seekTo(Math.min(current.track.durationMs, Math.max(0, displayedPositionMs + deltaMs)))
  }

  const handleProgressBarPress = (e: GestureResponderEvent) => {
    if (!current || barWidth === 0) return
    const fraction = Math.min(1, Math.max(0, e.nativeEvent.locationX / barWidth))
    seekTo(fraction * current.track.durationMs)
  }

  const handleBarLayout = (e: LayoutChangeEvent) => {
    setBarWidth(e.nativeEvent.layout.width)
  }

  // Checked after all hooks above have already run unconditionally (Rules of
  // Hooks) — this is a plain conditional render, not a hook being skipped.
  if (!roomId || !adapter) {
    return (
      <View style={styles.centerScreen}>
        <Text style={styles.errorText}>No active room/adapter — this shouldn't be reachable via normal navigation.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.title}>Room {roomId}</Text>

      {deviceError && (
        <View style={[styles.card, { borderColor: 'tomato' }]}>
          <Text style={styles.errorText}>
            Lost connection to your playback device — its session ended. This will recover automatically once you
            reopen it.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Now playing</Text>
        {current ? (
          <>
            <Text style={styles.nowPlayingTitle}>{current.track.title}</Text>
            <Text style={styles.nowPlayingArtist}>{current.track.artist}</Text>
            <TouchableOpacity style={styles.progressBarTrack} onLayout={handleBarLayout} onPress={handleProgressBarPress}>
              <View style={[styles.progressBarFill, { width: `${(displayedPositionMs / current.track.durationMs) * 100}%` }]} />
            </TouchableOpacity>
            <View style={styles.progressTimes}>
              <Text style={styles.monoText}>{formatTime(displayedPositionMs)}</Text>
              <Text style={styles.monoText}>{formatTime(current.track.durationMs)}</Text>
            </View>
          </>
        ) : (
          <Text style={styles.nowPlayingArtist}>Nothing yet — add a track below and press play.</Text>
        )}
        <View style={styles.row}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => seekBy(-SEEK_STEP_MS)} disabled={!current}>
            <Text style={styles.secondaryButtonText}>⟲ 15s</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryButton} onPress={roomState?.isPlaying ? pause : resume} disabled={!current}>
            <Text style={styles.primaryButtonText}>{roomState?.isPlaying ? 'Pause' : 'Resume'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => seekBy(SEEK_STEP_MS)} disabled={!current}>
            <Text style={styles.secondaryButtonText}>15s ⟳</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={skipNext}
            disabled={!roomState || roomState.currentIndex + 1 >= roomState.queue.length}
          >
            <Text style={styles.secondaryButtonText}>Skip</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Search ({activeAdapter.platform === 'spotify' ? 'Spotify' : 'Apple Music'} catalog)</Text>
        <TextInput
          style={styles.input}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by title, artist..."
          placeholderTextColor="#6b6375"
        />
        {searchResults.map((track) => (
          <View key={track.platformId} style={styles.queueRow}>
            <Text style={styles.queueRowText} numberOfLines={1}>
              {track.title} — {track.artist}
            </Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                addToQueue(toSharedTrack(activeAdapter, track), 'me')
                say(`Added "${track.title}" to the queue`)
              }}
            >
              <Text style={styles.secondaryButtonText}>+ Queue</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Queue</Text>
        {roomState?.queue.length === 0 && <Text style={styles.nowPlayingArtist}>Queue is empty — search above to add something.</Text>}
        {roomState?.queue.map((item, i) => (
          <View key={item.id} style={styles.queueRow}>
            <Text style={[styles.queueRowText, i === roomState.currentIndex && styles.queueRowTextCurrent]} numberOfLines={1}>
              {item.track.title} — {item.track.artist}
            </Text>
            <View style={styles.row}>
              {i !== roomState.currentIndex && (
                <TouchableOpacity style={styles.secondaryButton} onPress={() => gotoIndex(i)}>
                  <Text style={styles.secondaryButtonText}>Play</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  removeFromQueue(item.id)
                  say(`Removed "${item.track.title}" from the queue`)
                }}
              >
                <Text style={styles.secondaryButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Activity log</Text>
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </View>
    </ScrollView>
  )
}
