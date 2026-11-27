import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { unit1Data } from '@seed/schema';
import { attachParticle, hasBatchim } from '@seed/learning-engine';
import { GeometricBadge } from '../components/SeedArt';
import { speakKorean } from '../lib/speech';

export function DictionaryScreen() {
  const { width } = useWindowDimensions();
  const isPhone = width < 640;
  const [search, setSearch] = useState('');
  const [onlyHanja, setOnlyHanja] = useState(false);
  const [probeWord, setProbeWord] = useState('서울');

  const filtered = unit1Data.vocabulary.filter((v) => {
    if (onlyHanja && !v.hanja) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      v.hangul.includes(q) ||
      v.meaningVi.toLowerCase().includes(q) ||
      (v.hanja?.hanViet.toLowerCase().includes(q) ?? false)
    );
  });

  const probeHasBatchim = probeWord.trim().length > 0 && hasBatchim(probeWord);

  return (
    <ScrollView contentContainerStyle={[styles.container, isPhone && styles.containerPhone]}>
      <View style={styles.labCard}>
        <Text style={styles.labTitle}>Kiểm tra Patchim & Trợ từ</Text>
        <TextInput
          style={styles.input}
          value={probeWord}
          onChangeText={setProbeWord}
          placeholder="Nhập danh từ tiếng Hàn (vd: 서울, 한국)..."
          placeholderTextColor="#8C7A6B"
        />
        {probeWord.trim().length > 0 && (
          <View style={styles.probeResults}>
            <Text style={styles.probeBadge}>
              {probeHasBatchim ? 'Có patchim' : 'Không patchim'}
            </Text>
            <View style={styles.chipGrid}>
              <Text style={styles.chip}>{attachParticle(probeWord, '은/는')}</Text>
              <Text style={styles.chip}>{attachParticle(probeWord, '이/가')}</Text>
              <Text style={styles.chip}>{attachParticle(probeWord, '을/를')}</Text>
              <Text style={styles.chip}>{attachParticle(probeWord, '이에요/예요')}</Text>
              <Text style={styles.chip}>{attachParticle(probeWord, '(으)로')}</Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.dictSection}>
        <Text style={styles.dictHeader}>Từ vựng Unit 1</Text>
        <View style={styles.filterRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={search}
            onChangeText={setSearch}
            placeholder="Tìm từ..."
            placeholderTextColor="#8C7A6B"
          />
          <Pressable
            style={[styles.filterBtn, onlyHanja && styles.filterBtnActive]}
            onPress={() => setOnlyHanja((v) => !v)}
          >
            <Text style={[styles.filterText, onlyHanja && styles.filterTextActive]}>
              Hán–Việt
            </Text>
          </Pressable>
        </View>

        <View style={styles.list}>
          {filtered.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.wordCard, pressed && styles.cardPressed]}
              onPress={() => speakKorean(item.hangul)}
            >
              <View style={styles.wordTop}>
                <View style={styles.wordHeadingGroup}>
                  <GeometricBadge name="audio" size={24} />
                  <Text style={styles.wordKo}>{item.hangul}</Text>
                </View>
                <Text style={styles.ipa}>/{item.ipa}/</Text>
              </View>
              <Text style={styles.wordVi}>{item.meaningVi}</Text>
              {item.hanja && (
                <Text style={styles.hanjaLine}>
                  Hán–Việt: {item.hanja.hanViet} ({item.hanja.characters})
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 20, maxWidth: 960, width: '100%', alignSelf: 'center' },
  containerPhone: { padding: 14, paddingBottom: 24, gap: 14 },
  labCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
    gap: 12,
  },
  labTitle: { fontSize: 18, fontWeight: '700', color: '#2C221E' },
  input: {
    borderWidth: 1.5,
    borderColor: '#DFD2C0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    backgroundColor: '#FFFFFF',
    color: '#2C221E',
  },
  probeResults: { gap: 10 },
  probeBadge: { fontSize: 13, fontWeight: '600', color: '#3E7B52' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: '#FFFFFF',
    color: '#2C221E',
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  dictSection: { gap: 12 },
  dictHeader: { fontSize: 18, fontWeight: '700', color: '#2C221E' },
  filterRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFFFF',
  },
  filterBtnActive: { backgroundColor: '#3E7B52', borderColor: '#2D5D3D' },
  filterText: { fontSize: 14, fontWeight: '600', color: '#5C4D42' },
  filterTextActive: { color: '#FFFFFF' },
  list: { gap: 10 },
  wordCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EAE2D6',
    gap: 5,
  },
  cardPressed: { opacity: 0.85 },
  wordTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wordHeadingGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordKo: { fontSize: 18.5, fontWeight: '700', color: '#2C221E' },
  ipa: { fontSize: 13, color: '#8C7A6B' },
  wordVi: { fontSize: 14.5, fontWeight: '500', color: '#4A3B32' },
  hanjaLine: { fontSize: 13, fontWeight: '600', color: '#8D6B4C', marginTop: 2 },
});
