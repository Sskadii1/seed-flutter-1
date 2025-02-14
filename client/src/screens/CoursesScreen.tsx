import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Course } from '@shared/schema';
import { CourseCard } from '@/components/CourseCard.native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/navigation';
import { i18n } from '@/lib/i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'Courses'>;

export function CoursesScreen({ navigation }: Props) {
  const { data: courses, isLoading } = useQuery<Course[]>({
    queryKey: ['/api/courses']
  });

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={courses}
        renderItem={({ item }) => (
          <View style={styles.cardContainer}>
            <CourseCard
              course={item}
              onPress={() => navigation.navigate('CourseDetails', { id: item.id })}
            />
          </View>
        )}
        keyExtractor={item => item.id.toString()}
        contentContainerStyle={styles.list}
      />
    </View>
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
  list: {
    padding: 16,
  },
  cardContainer: {
    marginBottom: 16,
  },
});
