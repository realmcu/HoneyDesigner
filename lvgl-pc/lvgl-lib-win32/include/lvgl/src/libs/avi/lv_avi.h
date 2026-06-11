/**
 * @file lv_avi.h
 *
 */

#ifndef LV_AVI_H
#define LV_AVI_H

#ifdef __cplusplus
extern "C" {
#endif

/*********************
 *      INCLUDES
 *********************/

#include "../../lv_conf_internal.h"
#include "../../misc/lv_types.h"
#include "../../draw/lv_draw_buf.h"
#include "../../widgets/image/lv_image.h"
#include "../../core/lv_obj_class.h"
#include LV_STDBOOL_INCLUDE
#include LV_STDINT_INCLUDE

#include "avidec.h"

#if LV_USE_AVI || LV_AVI_DEBUG_VIEW
/*********************
 *      DEFINES
 *********************/

/**********************
 *      TYPEDEFS
 **********************/

LV_ATTRIBUTE_EXTERN_DATA extern const lv_obj_class_t lv_avi_class;

/**********************
 * GLOBAL PROTOTYPES
 **********************/

/**
 * Create a avi object
 * @param parent    pointer to an object, it will be the parent of the new avi.
 * @return          pointer to the avi obj
 */
lv_obj_t * lv_avi_create(lv_obj_t * parent);

/**
 * Set the avi data to display on the object
 * @param obj       pointer to a avi object
 * @param src       1) pointer to an ::lv_image_dsc_t descriptor (which contains avi raw data) or
 *                  2) path to a avi file (e.g. "S:/dir/anim.avi")
 */
void lv_avi_set_src(lv_obj_t * obj, const void * src);

/**
 * Restart a avi animation.
 * @param obj pointer to a avi obj
 */
void lv_avi_restart(lv_obj_t * obj);

/**
 * Pause a avi animation.
 * @param obj pointer to a avi obj
 */
void lv_avi_pause(lv_obj_t * obj);

/**
 * Resume a avi animation.
 * @param obj pointer to a avi obj
 */
void lv_avi_resume(lv_obj_t * obj);

/**
 * Checks if the AVI was loaded correctly.
 * @param obj pointer to a avi obj
 */
bool lv_avi_is_loaded(lv_obj_t * obj);

/**
 * Get the frame time for the AVI.
 * @param obj pointer to a avi obj
 */
uint32_t lv_avi_get_frame_time(lv_obj_t * obj);

/**
 * Get the loop count for the AVI.
 * @param obj pointer to a avi obj
 */
int32_t lv_avi_get_loop_count(lv_obj_t * obj);

/**
 * Set the frame time for the AVI.
 * @param obj   pointer to a avi obj
 * @param time_ms the frame time to set
 */
void lv_avi_set_frame_time(lv_obj_t * obj, uint32_t time_ms);

/**
 * Set the loop count for the AVI.
 * @param obj   pointer to a avi obj
 * @param count the loop count to set
 */
void lv_avi_set_loop_count(lv_obj_t * obj, int32_t count);

/**********************
 *      MACROS
 **********************/

#endif /*LV_USE_AVI*/

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /*LV_AVI_H*/
