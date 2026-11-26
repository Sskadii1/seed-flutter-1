import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

export type BadgeName =
  | 'sprout'
  | 'brain'
  | 'book'
  | 'chart'
  | 'audio'
  | 'streak'
  | 'xp'
  | 'star'
  | 'check'
  | 'hint'
  | 'chat'
  | 'board';

interface GeometricBadgeProps {
  name: BadgeName;
  size?: number;
}

const BADGE_THEMES: Record<BadgeName, { bg: string; border: string }> = {
  sprout: { bg: '#3E7B52', border: '#2D5D3D' },
  brain: { bg: '#9C7A5B', border: '#785A3F' },
  book: { bg: '#C8AD8D', border: '#A38767' },
  chart: { bg: '#D4A373', border: '#B07D4F' },
  audio: { bg: '#B08968', border: '#8D6B4C' },
  streak: { bg: '#D97706', border: '#B45309' },
  xp: { bg: '#E09F3E', border: '#B67B20' },
  star: { bg: '#E09F3E', border: '#B67B20' },
  check: { bg: '#3E7B52', border: '#2D5D3D' },
  hint: { bg: '#D97706', border: '#B45309' },
  chat: { bg: '#3E7B52', border: '#2D5D3D' },
  board: { bg: '#B08968', border: '#8D6B4C' },
};

export function GeometricBadge({ name, size = 30 }: GeometricBadgeProps) {
  const theme = BADGE_THEMES[name];
  const r = Math.round(size * 0.34);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: r,
        backgroundColor: theme.bg,
        borderWidth: 1,
        borderBottomWidth: 2.5,
        borderColor: theme.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {name === 'sprout' && (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
          <View
            style={{
              width: size * 0.24,
              height: size * 0.24,
              backgroundColor: '#FFFDF9',
              borderTopLeftRadius: 8,
              borderBottomRightRadius: 8,
            }}
          />
          <View
            style={{
              width: size * 0.2,
              height: size * 0.32,
              backgroundColor: '#F4ECE1',
              borderTopRightRadius: 8,
              borderBottomLeftRadius: 8,
            }}
          />
        </View>
      )}
      {name === 'brain' && (
        <View style={{ flexDirection: 'row', gap: 3 }}>
          <View
            style={{
              width: size * 0.22,
              height: size * 0.38,
              borderRadius: 99,
              backgroundColor: '#FFFDF9',
            }}
          />
          <View
            style={{
              width: size * 0.22,
              height: size * 0.38,
              borderRadius: 99,
              backgroundColor: '#F4ECE1',
            }}
          />
        </View>
      )}
      {name === 'book' && (
        <View style={{ flexDirection: 'row', gap: 2 }}>
          <View
            style={{
              width: size * 0.22,
              height: size * 0.36,
              backgroundColor: '#FFFDF9',
              borderTopLeftRadius: 3,
              borderBottomLeftRadius: 3,
            }}
          />
          <View
            style={{
              width: size * 0.22,
              height: size * 0.36,
              backgroundColor: '#F4ECE1',
              borderTopRightRadius: 3,
              borderBottomRightRadius: 3,
            }}
          />
        </View>
      )}
      {name === 'chart' && (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2.5 }}>
          <View style={{ width: size * 0.12, height: size * 0.2, backgroundColor: '#FFFDF9', borderRadius: 2 }} />
          <View style={{ width: size * 0.12, height: size * 0.38, backgroundColor: '#FFFDF9', borderRadius: 2 }} />
          <View style={{ width: size * 0.12, height: size * 0.28, backgroundColor: '#F4ECE1', borderRadius: 2 }} />
        </View>
      )}
      {name === 'chat' && (
        <View style={{ alignItems: 'flex-start' }}>
          <View
            style={{
              width: size * 0.48,
              height: size * 0.34,
              backgroundColor: '#FFFDF9',
              borderRadius: size * 0.12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
            }}
          >
            <View style={{ width: size * 0.07, height: size * 0.07, borderRadius: 99, backgroundColor: '#3E7B52' }} />
            <View style={{ width: size * 0.07, height: size * 0.07, borderRadius: 99, backgroundColor: '#3E7B52' }} />
            <View style={{ width: size * 0.07, height: size * 0.07, borderRadius: 99, backgroundColor: '#3E7B52' }} />
          </View>
          <View
            style={{
              width: size * 0.12,
              height: size * 0.09,
              marginLeft: size * 0.08,
              marginTop: -2,
              backgroundColor: '#F4ECE1',
              borderBottomRightRadius: 4,
              borderBottomLeftRadius: 2,
            }}
          />
        </View>
      )}
      {name === 'audio' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2.5 }}>
          <View style={{ width: size * 0.1, height: size * 0.22, backgroundColor: '#FFFDF9', borderRadius: 99 }} />
          <View style={{ width: size * 0.1, height: size * 0.42, backgroundColor: '#FFFDF9', borderRadius: 99 }} />
          <View style={{ width: size * 0.1, height: size * 0.3, backgroundColor: '#F4ECE1', borderRadius: 99 }} />
        </View>
      )}
      {(name === 'streak' || name === 'xp' || name === 'star') && (
        <View
          style={{
            width: size * 0.36,
            height: size * 0.36,
            backgroundColor: '#FFFDF9',
            borderRadius: 3,
            transform: [{ rotate: '45deg' }],
          }}
        />
      )}
      {name === 'check' && (
        <View
          style={{
            width: size * 0.38,
            height: size * 0.2,
            borderLeftWidth: 2.5,
            borderBottomWidth: 2.5,
            borderColor: '#FFFDF9',
            transform: [{ rotate: '-45deg' }, { translateY: -1 }],
          }}
        />
      )}
      {name === 'hint' && (
        <View style={{ alignItems: 'center', gap: 2 }}>
          <View style={{ width: size * 0.13, height: size * 0.25, backgroundColor: '#FFFDF9', borderRadius: 99 }} />
          <View style={{ width: size * 0.13, height: size * 0.13, backgroundColor: '#FFFDF9', borderRadius: 99 }} />
        </View>
      )}
      {name === 'board' && (
        <View
          style={{
            width: size * 0.56,
            height: size * 0.4,
            borderRadius: 4,
            borderWidth: 1.8,
            borderColor: '#8D6B4C',
            backgroundColor: '#F5EFE6',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
          }}
        >
          <View style={{ width: size * 0.34, height: 2, backgroundColor: '#2C221E', borderRadius: 2 }} />
          <View style={{ width: size * 0.24, height: 2, backgroundColor: '#3E7B52', borderRadius: 2, alignSelf: 'flex-start', marginLeft: 3 }} />
        </View>
      )}
    </View>
  );
}

export type ButtonVariant = 'caramel' | 'sand' | 'espresso' | 'amber' | 'outline';

interface TactileButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: ViewStyle;
}

const VARIANT_STYLES: Record<
  ButtonVariant,
  { bg: string; border: string; text: string }
> = {
  caramel: { bg: '#3E7B52', border: '#2D5D3D', text: '#FFFFFF' },
  sand: { bg: '#B08968', border: '#8D6B4C', text: '#FFFFFF' },
  espresso: { bg: '#4A3B32', border: '#2C221E', text: '#FFFFFF' },
  amber: { bg: '#D97706', border: '#B45309', text: '#FFFFFF' },
  outline: { bg: '#FFFFFF', border: '#DFD2C0', text: '#5C4D42' },
};

export function TactileButton({
  label,
  onPress,
  variant = 'caramel',
  disabled = false,
  style,
}: TactileButtonProps) {
  const palette = VARIANT_STYLES[variant];

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderBottomWidth: pressed && !disabled ? 1.5 : 3.5,
          transform: [{ translateY: pressed && !disabled ? 1.5 : 0 }],
        },
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: 14.5,
    fontWeight: '600',
  },
});
