import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface RuleCardProps {
  badge?: string;
  title: string;
  summaryVi: string;
  vietnameseTrap: string;
  examples?: Array<{ ko: string; vi: string }>;
}

export function RuleCard({
  badge = 'Ngữ pháp',
  title,
  summaryVi,
  vietnameseTrap,
  examples,
}: RuleCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.badge}>{badge}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.summary}>{summaryVi}</Text>

      <View style={styles.trapBox}>
        <Text style={styles.trapTitle}>Lưu ý</Text>
        <Text style={styles.trapText}>{vietnameseTrap}</Text>
      </View>

      {examples && examples.length > 0 && (
        <View style={styles.exampleBox}>
          {examples.map((ex, i) => (
            <View key={i} style={[styles.exampleRow, i > 0 && styles.exampleRowBorder]}>
              <Text style={styles.exampleKo}>{ex.ko}</Text>
              <Text style={styles.exampleVi}>{ex.vi}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1.5,
    borderBottomWidth: 3.5,
    borderColor: '#EAE2D6',
    marginBottom: 16,
    gap: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F2F7F3',
    color: '#2D5D3D',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#2C221E',
    lineHeight: 24,
  },
  summary: {
    fontSize: 14.5,
    lineHeight: 23,
    color: '#4A3B32',
  },
  trapBox: {
    marginTop: 6,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    gap: 3,
  },
  trapTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  trapText: {
    fontSize: 13.5,
    lineHeight: 21,
    color: '#78350F',
  },
  exampleBox: {
    marginTop: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EAE0D2',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  exampleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 9,
  },
  exampleRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#EAE0D2',
  },
  exampleKo: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8D6B4C',
  },
  exampleVi: {
    fontSize: 14,
    color: '#5C4D42',
  },
});
