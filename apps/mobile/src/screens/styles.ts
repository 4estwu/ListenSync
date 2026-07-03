import { StyleSheet } from 'react-native'

// Rough parity with apps/web's dark theme (index.css's --bg/--accent/etc for
// prefers-color-scheme: dark) — not meant to be final, just enough that this
// doesn't look like an unstyled prototype. Real design pass is future work.
const COLORS = {
  bg: '#16171d',
  card: '#1f2028',
  border: '#2e303a',
  text: '#9ca3af',
  textHeading: '#f3f4f6',
  accent: '#c084fc',
  accentBg: 'rgba(192, 132, 252, 0.15)',
  error: 'tomato',
}

export const styles = StyleSheet.create({
  centerScreen: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    padding: 20,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: COLORS.textHeading,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.text,
    textAlign: 'center',
    maxWidth: 320,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: COLORS.accent,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  primaryButtonText: {
    color: COLORS.bg,
    fontWeight: '600',
    fontSize: 15,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  secondaryButtonText: {
    color: COLORS.textHeading,
    fontWeight: '500',
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
    color: COLORS.textHeading,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minWidth: 140,
  },
  errorText: {
    color: COLORS.error,
    textAlign: 'center',
  },
  card: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: COLORS.text,
    opacity: 0.7,
  },
  nowPlayingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textHeading,
  },
  nowPlayingArtist: {
    fontSize: 15,
    color: COLORS.text,
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: COLORS.border,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: COLORS.accent,
  },
  progressTimes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  monoText: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: COLORS.text,
  },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 8,
  },
  queueRowText: {
    color: COLORS.text,
    flex: 1,
  },
  queueRowTextCurrent: {
    color: COLORS.textHeading,
    fontWeight: '600',
  },
  logLine: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: COLORS.text,
  },
})
