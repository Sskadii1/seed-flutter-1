import React from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import type { Teacher } from '@shared/schema';

interface TeacherCardProps {
  teacher: Teacher;
  onPress: () => void;
}

export function TeacherCard({ teacher, onPress }: TeacherCardProps) {
  return (
    <Pressable onPress={onPress} style={styles.container}>
      <Image
        source={{ uri: teacher.imageUrl }}
        style={styles.image}
        resizeMode="cover"
      />
      <View style={styles.content}>
        <Text style={styles.name}>{teacher.name}</Text>
        <Text style={styles.title}>{teacher.title}</Text>
        <Text style={styles.bio} numberOfLines={2}>
          {teacher.bio}
        </Text>
        <View style={styles.stats}>
          <Text style={styles.rating}>⭐️ {teacher.rating}/5</Text>
          <Text style={styles.students}>{teacher.totalStudents} học viên</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 200,
    backgroundColor: 'white',
    borderRadius: 12,
    marginRight: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  image: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignSelf: 'center',
    marginTop: 16,
  },
  content: {
    padding: 12,
    alignItems: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: 'bold',
    marginVertical: 4,
  },
  title: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  bio: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  rating: {
    fontSize: 12,
    color: '#666',
  },
  students: {
    fontSize: 12,
    color: '#666',
  },
});
