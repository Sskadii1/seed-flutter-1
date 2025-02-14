import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Course, Teacher } from '@shared/schema';
import { i18n } from '@/lib/i18n';
import { CourseCard } from '@/components/CourseCard.native';
import { TeacherCard } from '@/components/TeacherCard.native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { data: courses, isLoading: coursesLoading } = useQuery<Course[]>({
    queryKey: ['/api/courses']
  });

  const { data: teachers, isLoading: teachersLoading } = useQuery<Teacher[]>({
    queryKey: ['/api/teachers']
  });

  if (coursesLoading || teachersLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{i18n.home.hero.title}</Text>
        <Text style={styles.heroSubtitle}>{i18n.home.hero.subtitle}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{i18n.common.courses}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {courses?.map(course => (
            <CourseCard 
              key={course.id} 
              course={course}
              onPress={() => navigation.navigate('CourseDetails', { id: course.id })}
            />
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{i18n.common.teachers}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {teachers?.map(teacher => (
            <TeacherCard 
              key={teacher.id} 
              teacher={teacher}
              onPress={() => navigation.navigate('TeacherProfile', { id: teacher.id })}
            />
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hero: {
    padding: 20,
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#666',
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
  },
});