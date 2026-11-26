import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { composeHangulFromJamo } from '@seed/learning-engine';

interface HangulKeyboardProps {
  tokens: string[];
  onChangeTokens: (nextTokens: string[], composedText: string) => void;
}

const ROW_1_BASE = ['ㅂ', 'ㅈ', 'ㄷ', 'ㄱ', 'ㅅ', 'ㅛ', 'ㅕ', 'ㅑ', 'ㅐ', 'ㅔ'];
const ROW_1_SHIFT = ['ㅃ', 'ㅉ', 'ㄸ', 'ㄲ', 'ㅆ', 'ㅛ', 'ㅕ', 'ㅑ', 'ㅒ', 'ㅖ'];
const ROW_2 = ['ㅁ', 'ㄴ', 'ㅇ', 'ㄹ', 'ㅎ', 'ㅗ', 'ㅓ', 'ㅏ', 'ㅣ'];
const ROW_3 = ['ㅋ', 'ㅌ', 'ㅊ', 'ㅍ', 'ㅠ', 'ㅜ', 'ㅡ'];

export function HangulKeyboard({ tokens, onChangeTokens }: HangulKeyboardProps) {
  const [shifted, setShifted] = useState(false);

  const pushToken = (ch: string) => {
    const next = [...tokens, ch];
    onChangeTokens(next, composeHangulFromJamo(next));
    if (shifted) setShifted(false);
  };

  const handleBackspace = () => {
    if (tokens.length === 0) return;
    const next = tokens.slice(0, -1);
    onChangeTokens(next, composeHangulFromJamo(next));
  };

  const row1 = shifted ? ROW_1_SHIFT : ROW_1_BASE;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {row1.map((key) => (
          <Pressable
            key={key}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
            onPress={() => pushToken(key)}
          >
            <Text style={styles.keyText}>{key}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        {ROW_2.map((key) => (
          <Pressable
            key={key}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
            onPress={() => pushToken(key)}
          >
            <Text style={styles.keyText}>{key}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Pressable
          style={[styles.key, styles.fnKey, shifted && styles.fnKeyActive]}
          onPress={() => setShifted((s) => !s)}
        >
          <Text style={[styles.fnText, shifted && styles.fnTextActive]}>Shift</Text>
        </Pressable>
        {ROW_3.map((key) => (
          <Pressable
            key={key}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
            onPress={() => pushToken(key)}
          >
            <Text style={styles.keyText}>{key}</Text>
          </Pressable>
        ))}
        <Pressable style={[styles.key, styles.fnKey]} onPress={handleBackspace}>
          <Text style={styles.fnText}>Xóa</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        <Pressable
          style={({ pressed }) => [styles.key, styles.spaceKey, pressed && styles.keyPressed]}
          onPress={() => pushToken(' ')}
        >
          <Text style={styles.fnText}>Space</Text>
        </Pressable>
        <Pressable style={[styles.key, styles.fnKey]} onPress={() => pushToken('.')}>
          <Text style={styles.fnText}>.</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 10,
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: '#EAE2D6',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
    marginBottom: 6,
  },
  key: {
    minWidth: 34,
    paddingHorizontal: 9,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderBottomWidth: 3,
    borderColor: '#DFD2C0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    borderBottomWidth: 1,
    transform: [{ translateY: 1.5 }],
  },
  keyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2C221E',
  },
  fnKey: {
    backgroundColor: '#EFE8DD',
    borderColor: '#D6C5B0',
    paddingHorizontal: 12,
  },
  fnKeyActive: {
    backgroundColor: '#3E7B52',
    borderColor: '#2D5D3D',
  },
  fnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#5C4D42',
  },
  fnTextActive: {
    color: '#FFFFFF',
  },
  spaceKey: {
    flex: 1,
    maxWidth: 200,
    backgroundColor: '#FFFFFF',
  },
});
